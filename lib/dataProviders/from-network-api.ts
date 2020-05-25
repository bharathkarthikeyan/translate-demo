import fetch from 'node-fetch';

/**
 * Load necessary data using Suitest Network API
 */
export const getData = async (
	tokenId: string,
	tokenPassword: string,
	testPackRunId: string,
	testResultId: string
) => {
	// Sutiest Network API base URL
	const base = 'https://the.suite.st/api/public/v3/';
	// Authentication headers
	const headers = {
		'X-TokenId': tokenId,
		'X-TokenPassword': tokenPassword,
		'accept': 'application/json',
	};
	// Load both test pack run and specific test result
	const requests = await Promise.all([
		fetch(`${base}test-pack-runs/${testPackRunId}`, {headers}),
		fetch(`${base}results/${testResultId}`, {headers}),
	]);

	const failed = requests.find(req => !req.ok);
	if (failed) {
		throw new Error(`Failed to fetch the result: ${failed.status} - ${failed.statusText}`);
	}

	const [testPackRun, testResult] = await Promise.all(requests.map(req => req.json()));

	// Return all the data, that is needed to render test result
	return {
		testDefinition: testResult.detailed.def,
		snippetDefinitions: testResult.detailed.snippets,
		elementNames: testResult.detailed.elements,
		testResults: testResult.detailed.results,
		appConfig: testPackRun.effectiveAppConfig,
	};
};