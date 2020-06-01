// @ts-nocheck
import {translateTestLineResult} from '@suitest/translate';
import {
	TestLine,
	TestLineResult,
	AppConfiguration,
} from '@suitest/types';
import {toText} from '@suitest/smst-to-text';
import {toHtml} from '@suitest/smst-to-html';
import ejs from 'ejs';
import fs from 'fs';
import util from 'util';
import path from 'path';
import yargs from 'yargs';

// Read input data for the script
yargs
	.options('steps-only', {
		type: 'boolean',
		description: 'Render only steps to reproduce',
	})
	.option('own-demo', {
		type: 'boolean',
		alias: 'o',
		description: 'Use own data for demo',
	})
	.option('token-id', {
		type: 'string',
		alias: 'i',
		description: 'Your org token id: https://suite.st/docs/faq/ids-tokens/#token-id',
	})
	.option('token-password', {
		type: 'string',
		alias: 'p',
		description: 'Your org token password: https://suite.st/docs/faq/ids-tokens/#token-password',
	})
	.option('test-result-id', {
		type: 'string',
		alias: 't',
		description: 'Test result ID, that you want to render: https://suite.st/docs/suitest-network-api/api-reference/'
	})
	.option('test-pack-run-id', {
		type: 'string',
		alias: 'r',
		description: 'Test pack run id: https://suite.st/docs/suitest-network-api/api-reference/',
	})
	.help('help');

const options = yargs.parse();

type Names = { [key: string]: { name: string } };

// A data structure for translated test line
// i.e. everything that's needed is prepared for rendering
type ProcessedLine = {
	plainText: string,
	formattedText: string,
	html: string,
	lineNumber: number,
	startTime: Date,
	children?: ProcessedLine[][],
	includeInStepsToReproduce: boolean,
};

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

/**
 * Very basic helper to replace ANSI formatting with simple HTML/CSS
 */
const ansiToHtml = (text: string): string =>
	text.replace(/\u001b\[(\d+)m/g, (...m) => (
		{
			'0': '</span>',
			'32': '<span style="color: green">',
			'36': '<span style="color: darkcyan">',
			'4': '<span style="text-decoration: underline">',
			'31': '<span style="color: darkred">',
			'33': '<span style="color: darkorange">',
			'34': '<span style="color: darkblue">',
		}[m[1]]
	));

/**
 * Translate a single test line result
 * @return tuple of 3 strings - plain text, formatted text and html render of the line
 */
const translateSingleLine = (
	testLine: TestLine,
	appConfig: AppConfiguration,
	lineResult?: TestLineResult,
	snippetNames?: Names,
	elementNames?: Names,
	previousComments?: TestLine[]
): [string, string, string] => {
	const translations = previousComments?.map(commentLine => translateTestLineResult({
		testLine: commentLine,
		appConfig
	})) ?? [];

	translations.push(translateTestLineResult({
		lineResult,
		testLine,
		appConfig,
		elements: elementNames,
		snippets: snippetNames,
	}));

	return translations
		// Render to text / html
		.map(smst => ([
			toText(smst, false),
			ansiToHtml(toText(smst, true)),
			toHtml(smst),
		]))
		// transpose array
		.reduce((prev, next) => next.map((item, i) =>
			(prev[i] ?? []).concat(next[i])
		), [])
		// Join pieces to single array [text, formattedText, html]
		.map(item => item.join('\n'));
};

/**
 * Defined if provided line is a command and should be included in the steps to reproduce
 */
const isCommand = (testLine: TestLine): boolean => ![
	'sleep', 'assert', 'wait', 'runSnippet',
].includes(testLine.type);

/**
 * Translate an array of lines
 */
const translate = (data: {
	testDefinition: TestLine[],
	snippetDefinitions: { [key: string]: TestLine[] },
	testResults?: TestLineResult[],
	appConfig: AppConfiguration,
	snippetNames?: Names,
	elementNames?: Names,
}): ProcessedLine[] => {
	let lineIndex = 0;
	let previousComments = [];

	return data.testDefinition.map(testLine => {
		if (testLine.type === 'comment') {
			// Comments are skipped in the result
			previousComments.push(testLine);
			return;
		}

		// Map result by it's index
		const lineResult = data.testResults[lineIndex];

		const [plainText, formattedText, html] = translateSingleLine(
			testLine,
			data.appConfig,
			lineResult,
			data.snippetNames,
			data.elementNames,
			previousComments,
		);

		const output: ProcessedLine = {
			plainText,
			formattedText,
			html,
			lineNumber: lineIndex + 1,
			startTime: new Date(lineResult?.timeStarted),
			includeInStepsToReproduce: isCommand(testLine)
				|| lineResult?.result !== 'success'
				|| testLine.fatal,
		};

		if (testLine.type === 'runSnippet') {
			// This is a snippet, process child lines and loops
			let loops: TestLineResult[] = [];

			if (Array.isArray(lineResult?.results) && !Array.isArray(lineResult?.loopResults)) {
				// Wrap results into a single loop to unify the way we process this
				loops = [lineResult.results];
			} else if (Array.isArray(lineResult?.loopResults)) {
				loops = lineResult.loopResults.map(res => res.results);
			}

			if (loops.length) {
				const definition = [...data.snippetDefinitions[testLine.val]];

				if (definition[0] && definition[0].type === 'openApp') {
					definition.shift();
				}

				output.children = loops.map(loop => {
					return translate({
						testDefinition: definition,
						snippetDefinitions: data.snippetDefinitions,
						testResults: loop,
						appConfig: data.appConfig,
						snippetNames: data.snippetNames,
						elementNames: data.elementNames,
					});
				});
			}
		}

		previousComments = [];
		lineIndex++;

		return output;
	}).filter(Boolean);
};

const main = async (): Promise<void> => {
	// Depending on input params, either read input data from local files, or load it from Network API
	let data;
	if (options.ownDemo) {
		data = await (await import('./dataProviders/from-network-api')).getData(
			options.tokenId,
			options.tokenPassword,
			options.testPackRunId,
			options.testResultId
		);
	} else {
		data = (await import('./dataProviders/from-local-files')).default;
	}

	let translations = translate(data);

	if (options.stepsOnly) {
		// When displaying steps to reproduce, we don't care about the structure of
		// the test and passed assertions - display a list of commands and failed assertions only
		translations = translations
			// Flatten the structure, as we don't care for structure anymore
			.map(translation => {
				if (translation.children) {
					return [{...translation, children: undefined}].concat(translation.children);
				}

				return translation;
			})
			.flat(Number.POSITIVE_INFINITY)
			// Remove all unnecessary lines
			.filter(line => line.includeInStepsToReproduce);
	}

	const templatePath = path.join(__dirname, 'index.ejs');
	const template = await readFile(templatePath, 'utf8');
	const rendered = ejs.render(template, {translations}, {filename: templatePath});
	await writeFile(path.join(__dirname, '..', 'build', 'index.html'), rendered, 'utf8');
};

main().catch(e => {
	console.error(e);
	process.exit(1);
});
