// @ts-nocheck
import {translateTestLineResult} from '@suitest/translate';
import {
	TestLine,
	TestLineResult,
} from '@suitest/types';
import {toText} from '@suitest/smst-to-text';
import {toHtml} from '@suitest/smst-to-html';
import ejs from 'ejs';
import fs from 'fs';
import util from 'util';
import path from 'path';

// Import default data for the demo
import appConfig from '../data/config.json';
import testDefinition from '../data/definition.json';
import snippetDefinitions from '../data/snippets.json';
import snippetNames from '../data/snippetNames.json';
import elementNames from '../data/elements.json';
import testResults from '../data/result.json';

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

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

const translate = (testDefinition: TestLine[], testResults: TestLineResult[], parentLineId = ''): Array<[string, string, string]> =>
	testDefinition.map((testLine, lineNumber) => {
		const lineResult = testResults.find(result =>
			result.lineId === testLine.lineId || result.lineId === parentLineId + '-' + (lineNumber + 1)
		);

		const smst = translateTestLineResult({
			lineResult,
			testLine,
			appConfig,
			elements: elementNames,
			snippets: snippetNames,
		});

		const output = [[
			toText(smst, false),
			ansiToHtml(toText(smst, true)),
			toHtml(smst),
		]];

		if (testLine.type === 'runSnippet') {
			if (snippetDefinitions[testLine.val]) {
				// TODO - this can handle 1 snippet depth at the moment, should improve result lookup
				return output.concat(translate(snippetDefinitions[testLine.val], lineResult.results, testLine.lineId));
			}
		}

		return output;
	}).reduce((acc, item) => acc.concat(item), []);

const main = async (): Promise<void> => {
	const translations = translate(testDefinition, testResults);
	const template = await readFile(path.join(__dirname, 'index.ejs'), 'utf8');
	const rendered = ejs.render(template, {translations});
	await writeFile(path.join(__dirname, '..', 'build', 'index.html'), rendered, 'utf8');
};

main().catch(e => {
	console.error(e);
	process.exit(1);
});
