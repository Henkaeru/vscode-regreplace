/**
 * Regreplace
 *
 * @author Dominique Rau [domi.github@gmail.com](mailto:domi.github@gmail.com)
 * @version 0.0.1
 */

import * as DiffMatchPatch from 'diff-match-patch';
import { Position, Range, TextDocument, TextEdit, window, workspace, WorkspaceEdit } from 'vscode';
import onSave from './on-save';
import {
	applyFilePreviews,
	buildFilePreview,
	pickExecutionMode,
	previewAndMaybeApply,
} from './preview';
import { getConfiguration } from './utils';

export interface ICommand {
	name?: string;
	match?: string | string[];
	exclude?: string | string[];
	language?: string | string[];
	priority?: number;
	find?: string;
	regexp?: string;
	replace: string;
	flags?: string;
	global?: boolean;
}

/**
 * calculate target text by applying regex rules
 */
export function calculateTargetText(
	document: TextDocument,
	rules?: ICommand[],
): string | undefined {
	try {
		const allCommands = getConfiguration<ICommand[]>('commands');
		const commands = rules ?? allCommands;

		const currentText = document.getText();
		const fileName = document.fileName;

		const fileMatches = (pattern: string) =>
			pattern && pattern.length > 0 && new RegExp(pattern).test(fileName);

		const language = document.languageId;

		const activeCommands = commands.filter(cfg => {
			const matchPattern = cfg.match || '';
			const negatePattern = cfg.exclude || '';

			const isMatch =
				typeof matchPattern === 'string'
					? matchPattern.length === 0 || fileMatches(matchPattern)
					: matchPattern.some(mp => fileMatches(mp));

			const isNegate =
				typeof negatePattern === 'string'
					? negatePattern.length > 0 && fileMatches(negatePattern)
					: negatePattern.some(mp => fileMatches(mp));

			const hasLanugageId = cfg.language != null;
			const isLanguageMatch =
				hasLanugageId &&
				(typeof cfg.language === 'string'
					? language === cfg.language
					: cfg.language.some(l => l === language));

			return !isNegate && (hasLanugageId ? isLanguageMatch : isMatch);
		});

		if (activeCommands.length === 0) {
			return;
		}

		const sortedCommands = activeCommands.sort((a, b) => (a.priority || 0) - (b.priority || 0));

		let resultText = currentText;
		for (const command of sortedCommands) {
			if (command == null) {
				continue;
			}
			try {
				let regexQuery, regexReplace;

				if (command.regexp && command.regexp.length > 0) {
					regexQuery = command.regexp;
				} else if (command.find && command.find.length > 0) {
					regexQuery = command.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				} else {
					continue;
				}

				if (command.replace != null) {
					regexReplace = command.replace;
				} else {
					continue;
				}

				const flags = command.flags ?? 'g';
				const reg = new RegExp(regexQuery, flags);
				resultText = resultText.replace(reg, regexReplace);
			} catch (error) {
				if (!getConfiguration<boolean>('suppress-warnings')) {
					window.showWarningMessage(
						`Error regreplacing in command ${command.name || 'Unnamed rule'}: ${error}`,
					);
				}
				return null;
			}
		}

		return resultText;
	} catch (error) {
		if (!getConfiguration<boolean>('suppress-warnings')) {
			window.showWarningMessage(`Error regreplacing: ${error}`);
		}
		return document.getText();
	}
}

/** @deprecated use calculateTargetText */
export function calculateTargetTextForAllRules(
	document: TextDocument,
	singleCommand?: ICommand,
): string | undefined {
	return calculateTargetText(document, singleCommand ? [singleCommand] : undefined);
}

export function getDiff(source, target) {
	var dmp = new DiffMatchPatch();
	return dmp.diff_main(source, target);
}

export function getPositionFromIndex(text: string, idx: number) {
	var front = text.substring(0, idx);
	var lineEndings = front.match(/\n/g);
	var lineNum = 0;
	if (lineEndings != null) {
		lineNum = lineEndings.length;
	}
	var lastLine = front.lastIndexOf('\n');
	var charPos = lastLine != -1 ? idx - lastLine - 1 : idx;
	return new Position(lineNum, charPos);
}

export enum CustomEditType {
	Replace = 0,
	Delete = -1,
	Insert = 1,
}

interface CustemTextEdit {
	action: CustomEditType;
	range: Range;
	position?: Position;
	value: string;
}

export function getCustomEdits(source, target): CustemTextEdit[] {
	var diff = getDiff(source, target);

	var edits = [];
	var currentIndex = 0;

	diff.forEach(([action, value], idx) => {
		switch (action) {
			case 0:
				currentIndex += value.length;
				break;
			case -1:
				let fromIdx = currentIndex;
				let toIdx = currentIndex + value.length;
				let sourceRange = new Range(
					getPositionFromIndex(source, fromIdx),
					getPositionFromIndex(source, toIdx),
				);

				if (idx < diff.length - 1 && diff[idx + 1][0] === 1) {
					edits.push({
						action: CustomEditType.Replace,
						range: sourceRange,
						position: null,
						value: diff[idx + 1][1],
					});
					currentIndex += value.length;
				} else {
					edits.push({
						action: CustomEditType.Delete,
						range: sourceRange,
						position: null,
						value: '',
					});
					currentIndex += value.length;
				}
				break;
			case 1:
				if (idx == 0 || diff[idx - 1][0] !== -1) {
					const p = getPositionFromIndex(source, currentIndex);
					edits.push({
						action: CustomEditType.Insert,
						range: new Range(p, p),
						position: p,
						value: value,
					});
				}
				break;
		}
	});
	return edits;
}

export function buildTextEdits(source: string, target: string): TextEdit[] {
	const edits = getCustomEdits(source, target);
	return edits.map(e => {
		switch (e.action) {
			case CustomEditType.Replace:
			case CustomEditType.Insert:
				return new TextEdit(e.range, e.value);
			case CustomEditType.Delete:
				return new TextEdit(e.range, '');
		}
	});
}

export async function applyRegreplaceToDocument(
	document: TextDocument,
	rules?: ICommand[],
): Promise<boolean> {
	const newText = calculateTargetText(document, rules);
	if (newText == null || newText === document.getText()) {
		return false;
	}

	const textEdits = buildTextEdits(document.getText(), newText);
	const workspaceEdit = new WorkspaceEdit();
	workspaceEdit.set(document.uri, textEdits);
	return workspace.applyEdit(workspaceEdit);
}

function applyEditsForNewText(regreplacedText: string) {
	const { activeTextEditor: editor, activeTextEditor: { document } } = window;

	return editor.edit(edit => {
		const edits = getCustomEdits(document.getText(), regreplacedText);
		edits.forEach(e => {
			switch (e.action) {
				case 0:
					edit.replace(e.range, e.value);
					break;
				case 1:
					edit.insert(e.position, e.value);
					break;
				case -1:
					edit.delete(e.range);
					break;
			}
		});
		return edit;
	});
}

export async function regreplaceCurrentDocument() {
	const editor = window.activeTextEditor;
	if (!editor) {
		window.showInformationMessage('RegReplace: No active editor.');
		return;
	}

	const mode = await pickExecutionMode('file');
	if (!mode) {
		return;
	}

	const { document } = editor;
	const preview = buildFilePreview(document);
	if (!preview) {
		window.showInformationMessage('RegReplace: No changes needed.');
		return;
	}

	if (mode === 'preview') {
		await previewAndMaybeApply([preview]);
		return;
	}

	await applyEditsForNewText(calculateTargetText(document)!);
}

export async function saveWithoutReplacing() {
	const { document } = window.activeTextEditor;
	onSave.bypass(async () => await document.save());
}

export async function pickRules(): Promise<ICommand[] | undefined> {
	const commands = getConfiguration<ICommand[]>('commands');
	if (commands.length === 0) {
		window.showInformationMessage('No regreplace rules configured.');
		return;
	}

	const items = commands.map((cmd, idx) => ({
		label: cmd.name || `Unnamed rule ${idx}`,
		description: cmd.regexp || cmd.find || '',
		picked: true,
		rule: cmd,
	}));

	const selected = await window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: 'Select rules to run',
	});
	if (!selected || selected.length === 0) {
		return;
	}
	return selected.map(s => s.rule);
}

export async function runSelectedRulesOnCurrentFile() {
	const editor = window.activeTextEditor;
	if (!editor) {
		window.showInformationMessage('RegReplace: No active editor.');
		return;
	}

	const rules = await pickRules();
	if (!rules) {
		return;
	}

	const mode = await pickExecutionMode('file');
	if (!mode) {
		return;
	}

	const { document } = editor;
	const preview = buildFilePreview(document, rules);
	if (!preview) {
		window.showInformationMessage('RegReplace: No changes needed.');
		return;
	}

	if (mode === 'preview') {
		await previewAndMaybeApply([preview]);
		return;
	}

	const regreplacedText = calculateTargetText(document, rules)!;
	await applyEditsForNewText(regreplacedText);
}
