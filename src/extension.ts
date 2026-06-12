/**
 * Regreplace
 *
 * @author Dominique Rau [domi.github@gmail.com](mailto:domi.github@gmail.com)
 * @version 0.0.1
 */

import { commands, ExtensionContext, Uri, workspace } from 'vscode';
import { runOnFolder, runOnWorkspace } from './bulk-replace';
import onSave from './on-save';
import {
	regreplaceCurrentDocument,
	runSelectedRulesOnCurrentFile,
	saveWithoutReplacing,
} from './regreplace';
import { EXTENSION_NAME } from './utils';

export function activate({ subscriptions }: ExtensionContext) {
	subscriptions.push(
		commands.registerCommand(EXTENSION_NAME + '.regreplace', regreplaceCurrentDocument),
	);
	subscriptions.push(
		commands.registerCommand(EXTENSION_NAME + '.run-selected-rules', runSelectedRulesOnCurrentFile),
	);
	subscriptions.push(
		commands.registerCommand(EXTENSION_NAME + '.run-on-workspace', runOnWorkspace),
	);
	subscriptions.push(
		commands.registerCommand(EXTENSION_NAME + '.run-on-folder', (uri?: Uri) => runOnFolder(uri)),
	);
	subscriptions.push(
		commands.registerCommand(EXTENSION_NAME + '.save-without-regreplace', saveWithoutReplacing),
	);

	onSave.update();
	workspace.onDidChangeConfiguration(() => onSave.update());
}

export function deactivate() { }
