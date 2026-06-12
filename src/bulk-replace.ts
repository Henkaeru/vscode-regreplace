/**
 * Bulk regreplace across workspace and folders
 */

import {
	CancellationToken,
	ProgressLocation,
	RelativePattern,
	Uri,
	window,
	workspace,
} from 'vscode';
import { filterProcessableFiles, getExcludeGlobPattern } from './file-filter';
import {
	buildFilePreview,
	FilePreview,
	pickExecutionMode,
	previewAndMaybeApply,
} from './preview';
import {
	applyRegreplaceToDocument,
	calculateTargetText,
	ICommand,
	pickRules,
} from './regreplace';
import { getConfiguration } from './utils';

interface BulkOptions {
	rules?: ICommand[];
	saveAfter?: boolean;
	scopeLabel?: string;
}

interface BulkResult {
	processed: number;
	changed: number;
	skipped: number;
	errors: number;
}

async function pickRulesMode(): Promise<ICommand[] | undefined | null> {
	const choice = await window.showQuickPick(
		[
			{ label: 'All matching rules', mode: 'all' as const },
			{ label: 'Select rules...', mode: 'pick' as const },
		],
		{ placeHolder: 'Which rules to run?' },
	);
	if (!choice) {
		return null;
	}
	if (choice.mode === 'all') {
		return undefined;
	}
	return pickRules();
}

async function findFilesInScope(folderUri?: Uri): Promise<Uri[]> {
	const exclude = getExcludeGlobPattern();
	const include = getConfiguration<string>('bulk-include') || '**/*';

	let uris: Uri[];
	if (folderUri) {
		uris = await workspace.findFiles(new RelativePattern(folderUri, include), exclude);
	} else {
		uris = await workspace.findFiles(include, exclude);
	}

	return filterProcessableFiles(uris);
}

async function collectPreviews(
	uris: Uri[],
	rules?: ICommand[],
	token?: CancellationToken,
	report?: (message: string) => void,
): Promise<FilePreview[]> {
	const previews: FilePreview[] = [];

	for (const uri of uris) {
		if (token?.isCancellationRequested) {
			break;
		}

		const label = workspace.asRelativePath(uri);
		report?.(label);

		try {
			const document = await workspace.openTextDocument(uri);
			const preview = buildFilePreview(document, rules);
			if (preview) {
				previews.push(preview);
			}
		} catch {
			// skip unreadable files
		}
	}

	return previews;
}

async function processFiles(
	uris: Uri[],
	options: BulkOptions,
	token?: CancellationToken,
	report?: (message: string) => void,
): Promise<BulkResult> {
	const result: BulkResult = { processed: 0, changed: 0, skipped: 0, errors: 0 };

	for (const uri of uris) {
		if (token?.isCancellationRequested) {
			break;
		}

		result.processed++;
		const label = workspace.asRelativePath(uri);
		report?.(`${label}`);

		try {
			const document = await workspace.openTextDocument(uri);
			const hasApplicableRules = calculateTargetText(document, options.rules) != null;
			if (!hasApplicableRules) {
				result.skipped++;
				continue;
			}

			const changed = await applyRegreplaceToDocument(document, options.rules);
			if (changed) {
				result.changed++;
				if (options.saveAfter) {
					await document.save();
				}
			} else {
				result.skipped++;
			}
		} catch (error) {
			result.errors++;
			if (!getConfiguration<boolean>('suppress-warnings')) {
				window.showWarningMessage(`RegReplace failed on ${label}: ${error}`);
			}
		}
	}

	return result;
}

function showBulkResult(result: BulkResult, scopeLabel: string) {
	const parts = [`${result.changed} changed`, `${result.skipped} unchanged`];
	if (result.errors > 0) {
		parts.push(`${result.errors} errors`);
	}
	window.showInformationMessage(
		`RegReplace (${scopeLabel}): ${result.processed} processed, ${parts.join(', ')}.`,
	);
}

async function runBulk(uris: Uri[], options: BulkOptions) {
	const scopeLabel = options.scopeLabel || 'selection';

	const result = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: `RegReplace: ${scopeLabel}`,
			cancellable: true,
		},
		async (progress, token) => {
			return processFiles(uris, options, token, message => progress.report({ message }));
		},
	);

	showBulkResult(result, scopeLabel);
}

async function previewBulk(uris: Uri[], options: BulkOptions) {
	const scopeLabel = options.scopeLabel || 'selection';

	const previews = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: `RegReplace: Preview ${scopeLabel}`,
			cancellable: true,
		},
		async (progress, token) => {
			return collectPreviews(uris, options.rules, token, message => progress.report({ message }));
		},
	);

	await previewAndMaybeApply(previews);
}

async function getFolderUri(fromExplorer?: Uri): Promise<Uri | undefined> {
	if (fromExplorer) {
		return fromExplorer;
	}

	const picked = await window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'Select folder',
		defaultUri: workspace.workspaceFolders?.[0]?.uri,
	});
	return picked?.[0];
}

async function runOnScope(scope: 'workspace' | 'folder', folderUri?: Uri) {
	const rules = await pickRulesMode();
	if (rules === null) {
		return;
	}

	const mode = await pickExecutionMode('bulk');
	if (!mode) {
		return;
	}

	let uris: Uri[];
	let scopeLabel: string;

	if (scope === 'workspace') {
		uris = await findFilesInScope();
		scopeLabel = rules ? 'workspace (selected rules)' : 'workspace';
	} else {
		const uri = await getFolderUri(folderUri);
		if (!uri) {
			return;
		}
		uris = await findFilesInScope(uri);
		const folder = workspace.asRelativePath(uri) || uri.fsPath;
		scopeLabel = rules ? `folder ${folder} (selected rules)` : `folder ${folder}`;
	}

	if (uris.length === 0) {
		window.showInformationMessage(`RegReplace: No files found in ${scopeLabel}.`);
		return;
	}

	const saveAfter = mode === 'run-save';

	if (mode === 'preview') {
		await previewBulk(uris, { rules, scopeLabel, saveAfter });
		return;
	}

	await runBulk(uris, { rules, scopeLabel, saveAfter });
}

/** Run rules on every file in the workspace */
export async function runOnWorkspace() {
	await runOnScope('workspace');
}

/** Run rules on files under a folder */
export async function runOnFolder(folderUri?: Uri) {
	await runOnScope('folder', folderUri);
}
