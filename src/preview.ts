/**
 * Preview and apply regreplace modifications
 */

import {
	CustomEditType,
	calculateTargetText,
	getCustomEdits,
	ICommand,
} from './regreplace';
import {
	Position,
	Range,
	TextDocument,
	TextEdit,
	Uri,
	ViewColumn,
	WebviewPanel,
	window,
	workspace,
	WorkspaceEdit,
} from 'vscode';

export type ExecutionMode = 'preview' | 'run' | 'run-save';

export interface ModificationPreview {
	line: number;
	character: number;
	action: 'replace' | 'insert' | 'delete';
	oldText: string;
	newText: string;
	range: Range;
}

export interface FilePreview {
	uri: Uri;
	filePath: string;
	modifications: ModificationPreview[];
	textEdits: TextEdit[];
}

function toModification(document: TextDocument, edit: ReturnType<typeof getCustomEdits>[0]): ModificationPreview {
	const range = edit.range;
	const oldText =
		edit.action === CustomEditType.Insert
			? ''
			: document.getText(range);
	const newText =
		edit.action === CustomEditType.Delete
			? ''
			: edit.value;

	let action: ModificationPreview['action'];
	switch (edit.action) {
		case CustomEditType.Replace:
			action = 'replace';
			break;
		case CustomEditType.Insert:
			action = 'insert';
			break;
		case CustomEditType.Delete:
			action = 'delete';
			break;
	}

	return {
		line: range.start.line + 1,
		character: range.start.character + 1,
		action,
		oldText,
		newText,
		range,
	};
}

export function buildFilePreview(document: TextDocument, rules?: ICommand[]): FilePreview | null {
	const source = document.getText();
	const target = calculateTargetText(document, rules);
	if (target == null || target === source) {
		return null;
	}

	const customEdits = getCustomEdits(source, target);
	if (customEdits.length === 0) {
		return null;
	}

	const modifications = customEdits.map(e => toModification(document, e));
	const textEdits = customEdits.map(e => {
		switch (e.action) {
			case CustomEditType.Replace:
			case CustomEditType.Insert:
				return new TextEdit(e.range, e.value);
			case CustomEditType.Delete:
				return new TextEdit(e.range, '');
		}
	});

	return {
		uri: document.uri,
		filePath: workspace.asRelativePath(document.uri) || document.fileName,
		modifications,
		textEdits,
	};
}

export async function pickExecutionMode(scope: 'file' | 'bulk'): Promise<ExecutionMode | null> {
	const items =
		scope === 'file'
			? [
					{ label: 'Preview changes', description: 'Review each modification before applying', mode: 'preview' as const },
					{ label: 'Run', description: 'Apply changes immediately', mode: 'run' as const },
				]
			: [
					{ label: 'Preview changes', description: 'Review each modification before applying', mode: 'preview' as const },
					{ label: 'Run', description: 'Apply changes without saving', mode: 'run' as const },
					{ label: 'Run and save', description: 'Apply changes and save files', mode: 'run-save' as const },
				];

	const picked = await window.showQuickPick(items, {
		placeHolder: 'Preview or run?',
	});
	return picked?.mode ?? null;
}

export async function applyFilePreviews(previews: FilePreview[], saveAfter = false): Promise<number> {
	if (previews.length === 0) {
		return 0;
	}

	const workspaceEdit = new WorkspaceEdit();
	for (const preview of previews) {
		workspaceEdit.set(preview.uri, preview.textEdits);
	}
	await workspace.applyEdit(workspaceEdit);

	if (saveAfter) {
		for (const preview of previews) {
			const doc = await workspace.openTextDocument(preview.uri);
			if (doc.isDirty) {
				await doc.save();
			}
		}
	}

	return previews.length;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function truncate(text: string, max = 200): string {
	const normalized = text.replace(/\r\n/g, '\n');
	if (normalized.length <= max) {
		return normalized;
	}
	return `${normalized.slice(0, max)}...`;
}

function formatPreviewText(text: string): string {
	if (text.length === 0) {
		return '(empty)';
	}
	return truncate(text);
}

function buildPreviewHtml(previews: FilePreview[]): string {
	const totalMods = previews.reduce((n, p) => n + p.modifications.length, 0);
	const fileSections = previews
		.map(preview => {
			const mods = preview.modifications
				.map(mod => {
					const openPayload = encodeURIComponent(
						JSON.stringify({
							uri: preview.uri.toString(),
							line: mod.range.start.line,
							character: mod.range.start.character,
						}),
					);
					const oldBlock =
						mod.action !== 'insert'
							? `<div class="old"><span class="sign">-</span><pre>${escapeHtml(formatPreviewText(mod.oldText))}</pre></div>`
							: '';
					const newBlock =
						mod.action !== 'delete'
							? `<div class="new"><span class="sign">+</span><pre>${escapeHtml(formatPreviewText(mod.newText))}</pre></div>`
							: '';

					return `<article class="mod ${mod.action}">
						<div class="mod-head">
							<span class="badge ${mod.action}">${mod.action}</span>
							<span class="location">Line ${mod.line}:${mod.character}</span>
							<button class="open-link" data-open="${openPayload}">Open</button>
						</div>
						<div class="diff">${oldBlock}${newBlock}</div>
					</article>`;
				})
				.join('');

			return `<section class="file-group">
				<header class="file-header">
					<strong>${escapeHtml(preview.filePath)}</strong>
					<span class="count">${preview.modifications.length} change${preview.modifications.length === 1 ? '' : 's'}</span>
				</header>
				${mods}
			</section>`;
		})
		.join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<title>RegReplace Preview</title>
	<style>
		:root {
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		body { margin: 0; padding: 0; }
		.toolbar {
			position: sticky;
			top: 0;
			z-index: 2;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 12px 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}
		.summary { opacity: 0.9; }
		.actions { display: flex; gap: 8px; }
		button {
			border: 1px solid var(--vscode-button-border, transparent);
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			padding: 6px 12px;
			cursor: pointer;
			border-radius: 2px;
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.content { padding: 16px; }
		.file-group {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			margin-bottom: 16px;
			overflow: hidden;
		}
		.file-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 10px 12px;
			background: var(--vscode-sideBar-background);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.count { opacity: 0.75; font-size: 0.9em; }
		.mod { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
		.mod:last-child { border-bottom: none; }
		.mod-head {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 8px;
		}
		.badge {
			font-size: 0.75em;
			text-transform: uppercase;
			padding: 2px 6px;
			border-radius: 3px;
			font-weight: 600;
		}
		.badge.replace { background: var(--vscode-inputValidation-warningBackground); }
		.badge.insert { background: var(--vscode-diffEditor-insertedLineBackground, #2ea04333); }
		.badge.delete { background: var(--vscode-diffEditor-removedLineBackground, #f8514933); }
		.location { opacity: 0.8; font-family: var(--vscode-editor-font-family); }
		.open-link {
			margin-left: auto;
			padding: 2px 8px;
			font-size: 0.85em;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.diff pre {
			margin: 0;
			padding: 8px;
			white-space: pre-wrap;
			word-break: break-word;
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
			border-radius: 3px;
		}
		.old, .new { display: flex; gap: 8px; margin-top: 4px; }
		.sign { font-weight: bold; width: 12px; flex-shrink: 0; padding-top: 8px; }
		.old pre {
			background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.15));
			flex: 1;
		}
		.new pre {
			background: var(--vscode-diffEditor-insertedLineBackground, rgba(0, 255, 0, 0.12));
			flex: 1;
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<div class="summary">${previews.length} file${previews.length === 1 ? '' : 's'}, ${totalMods} modification${totalMods === 1 ? '' : 's'}</div>
		<div class="actions">
			<button class="secondary" id="close-btn">Close</button>
			<button class="secondary" id="apply-btn">Apply changes</button>
			<button id="apply-save-btn">Apply and save</button>
		</div>
	</div>
	<div class="content">${fileSections}</div>
	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById('apply-btn').addEventListener('click', () => vscode.postMessage({ command: 'apply' }));
		document.getElementById('apply-save-btn').addEventListener('click', () => vscode.postMessage({ command: 'apply-save' }));
		document.getElementById('close-btn').addEventListener('click', () => vscode.postMessage({ command: 'close' }));
		document.querySelectorAll('.open-link').forEach(btn => {
			btn.addEventListener('click', () => {
				vscode.postMessage({ command: 'open', ...JSON.parse(decodeURIComponent(btn.dataset.open)) });
			});
		});
	</script>
</body>
</html>`;
}

let activePanel: WebviewPanel | undefined;

export type PreviewAction = 'apply' | 'apply-save' | 'close';

export async function showPreviewPanel(previews: FilePreview[]): Promise<PreviewAction> {
	if (previews.length === 0) {
		window.showInformationMessage('RegReplace: No changes to preview.');
		return 'close';
	}

	if (activePanel) {
		activePanel.dispose();
	}

	return new Promise(resolve => {
		let settled = false;
		const finish = (action: PreviewAction) => {
			if (!settled) {
				settled = true;
				resolve(action);
			}
		};

		const panel = window.createWebviewPanel(
			'regreplacePreview',
			'RegReplace Preview',
			ViewColumn.Beside,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		activePanel = panel;
		panel.webview.html = buildPreviewHtml(previews);

		panel.webview.onDidReceiveMessage(async message => {
			if (message.command === 'apply') {
				finish('apply');
				panel.dispose();
			} else if (message.command === 'apply-save') {
				finish('apply-save');
				panel.dispose();
			} else if (message.command === 'close') {
				finish('close');
				panel.dispose();
			} else if (message.command === 'open') {
				const uri = Uri.parse(message.uri);
				const doc = await workspace.openTextDocument(uri);
				await window.showTextDocument(doc, {
					viewColumn: ViewColumn.One,
					selection: new Range(
						new Position(message.line, message.character),
						new Position(message.line, message.character),
					),
				});
			}
		});

		panel.onDidDispose(() => {
			if (activePanel === panel) {
				activePanel = undefined;
			}
			finish('close');
		});
	});
}

export async function previewAndMaybeApply(previews: FilePreview[]): Promise<boolean> {
	const action = await showPreviewPanel(previews);
	if (action === 'apply' || action === 'apply-save') {
		const saveAfter = action === 'apply-save';
		const changed = await applyFilePreviews(previews, saveAfter);
		window.showInformationMessage(
			`RegReplace: Applied ${changed} file${changed === 1 ? '' : 's'}${saveAfter ? ' and saved' : ''}.`,
		);
		return true;
	}
	return false;
}
