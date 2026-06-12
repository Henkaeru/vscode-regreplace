/**
 * Bulk operation file filtering (globs, extensions, mime types, binary sniffing)
 */

import { extname } from 'path';
import { Uri, workspace } from 'vscode';
import { getConfiguration } from './utils';

/** Default path globs - cache, deps, build output, tooling */
export const DEFAULT_EXCLUDE_GLOBS = [
	'**/.git/**',
	'**/node_modules/**',
	'**/.svn/**',
	'**/.hg/**',
	'**/dist/**',
	'**/out/**',
	'**/build/**',
	'**/.next/**',
	'**/.nuxt/**',
	'**/.svelte-kit/**',
	'**/.angular/**',
	'**/.docusaurus/**',
	'**/.cache/**',
	'**/.parcel-cache/**',
	'**/.vite/**',
	'**/.turbo/**',
	'**/.eslintcache/**',
	'**/__pycache__/**',
	'**/.pytest_cache/**',
	'**/.mypy_cache/**',
	'**/.ruff_cache/**',
	'**/.tox/**',
	'**/.venv/**',
	'**/venv/**',
	'**/.npm/**',
	'**/.yarn/**',
	'**/.pnpm-store/**',
	'**/bower_components/**',
	'**/target/**',
	'**/.gradle/**',
	'**/.idea/**',
	'**/.vs/**',
	'**/coverage/**',
	'**/.nyc_output/**',
	'**/.vscode-test/**',
	'**/.terraform/**',
	'**/.serverless/**',
	'**/*.egg-info/**',
];

/** Default extensions - media, archives, binaries, fonts, compiled artifacts */
export const DEFAULT_EXCLUDE_EXTENSIONS = [
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.ico',
	'.bmp',
	'.tif',
	'.tiff',
	'.heic',
	'.avif',
	'.mp3',
	'.mp4',
	'.wav',
	'.ogg',
	'.webm',
	'.avi',
	'.mov',
	'.mkv',
	'.flac',
	'.pdf',
	'.zip',
	'.gz',
	'.tar',
	'.rar',
	'.7z',
	'.bz2',
	'.xz',
	'.jar',
	'.war',
	'.exe',
	'.dll',
	'.so',
	'.dylib',
	'.bin',
	'.dat',
	'.wasm',
	'.class',
	'.pyc',
	'.pyo',
	'.o',
	'.a',
	'.lib',
	'.obj',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.eot',
	'.sqlite',
	'.sqlite3',
	'.db',
	'.lock',
];

/** Default mime patterns - non-text content */
export const DEFAULT_EXCLUDE_MIME_TYPES = [
	'image/*',
	'audio/*',
	'video/*',
	'font/*',
	'application/octet-stream',
	'application/pdf',
	'application/zip',
	'application/gzip',
	'application/x-gzip',
	'application/x-tar',
	'application/x-7z-compressed',
	'application/x-rar-compressed',
	'application/java-archive',
	'application/wasm',
];

const EXTENSION_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.bmp': 'image/bmp',
	'.svg': 'image/svg+xml',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.heic': 'image/heic',
	'.avif': 'image/avif',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
	'.webm': 'video/webm',
	'.avi': 'video/x-msvideo',
	'.mov': 'video/quicktime',
	'.mkv': 'video/x-matroska',
	'.flac': 'audio/flac',
	'.pdf': 'application/pdf',
	'.zip': 'application/zip',
	'.gz': 'application/gzip',
	'.tar': 'application/x-tar',
	'.rar': 'application/x-rar-compressed',
	'.7z': 'application/x-7z-compressed',
	'.jar': 'application/java-archive',
	'.exe': 'application/octet-stream',
	'.dll': 'application/octet-stream',
	'.so': 'application/octet-stream',
	'.dylib': 'application/octet-stream',
	'.bin': 'application/octet-stream',
	'.wasm': 'application/wasm',
	'.class': 'application/java-vm',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.eot': 'application/vnd.ms-fontobject',
	'.sqlite': 'application/x-sqlite3',
	'.sqlite3': 'application/x-sqlite3',
};

function normalizeExtension(ext: string): string {
	const lower = ext.toLowerCase();
	return lower.startsWith('.') ? lower : `.${lower}`;
}

function getConfiguredGlobs(): string[] {
	const globs = getConfiguration<string[]>('bulk-exclude-globs');
	const legacy = getConfiguration<string>('bulk-exclude');

	const result = globs?.length ? [...globs] : [...DEFAULT_EXCLUDE_GLOBS];

	if (legacy?.trim()) {
		const legacyGlobs = legacy
			.replace(/^\{|\}$/g, '')
			.split(',')
			.map(g => g.trim())
			.filter(Boolean);
		result.push(...legacyGlobs);
	}

	return [...new Set(result)];
}

export function getExcludeGlobPattern(): string {
	const globs = getConfiguredGlobs();
	return globs.length === 1 ? globs[0] : `{${globs.join(',')}}`;
}

function getConfiguredExtensions(): string[] {
	const extensions = getConfiguration<string[]>('bulk-exclude-extensions');
	const list = extensions?.length ? extensions : DEFAULT_EXCLUDE_EXTENSIONS;
	return list.map(normalizeExtension);
}

function getConfiguredMimeTypes(): string[] {
	const mimeTypes = getConfiguration<string[]>('bulk-exclude-mime-types');
	return mimeTypes?.length ? mimeTypes : DEFAULT_EXCLUDE_MIME_TYPES;
}

export function mimeMatchesPattern(mime: string, pattern: string): boolean {
	if (pattern.endsWith('/*')) {
		return mime.startsWith(pattern.slice(0, -1));
	}
	return mime === pattern;
}

export function guessMimeType(filePath: string, isBinary: boolean): string {
	const ext = normalizeExtension(extname(filePath));
	if (EXTENSION_MIME[ext]) {
		return EXTENSION_MIME[ext];
	}
	return isBinary ? 'application/octet-stream' : 'text/plain';
}

export function isExcludedByExtension(filePath: string): boolean {
	const ext = normalizeExtension(extname(filePath));
	if (!ext || ext === '.') {
		return false;
	}
	return getConfiguredExtensions().includes(ext);
}

export function isExcludedByMimeType(filePath: string, isBinary: boolean): boolean {
	const mime = guessMimeType(filePath, isBinary);
	return getConfiguredMimeTypes().some(pattern => mimeMatchesPattern(mime, pattern));
}

const BINARY_SAMPLE_SIZE = 8192;

export async function looksBinary(uri: Uri): Promise<boolean> {
	const data = await workspace.fs.readFile(uri);
	const sample = data.subarray(0, Math.min(data.length, BINARY_SAMPLE_SIZE));
	for (let i = 0; i < sample.length; i++) {
		if (sample[i] === 0) {
			return true;
		}
	}
	return false;
}

export async function shouldProcessFile(uri: Uri): Promise<boolean> {
	const filePath = uri.fsPath;

	if (isExcludedByExtension(filePath)) {
		return false;
	}

	const ext = normalizeExtension(extname(filePath));
	const knownMime = EXTENSION_MIME[ext];
	if (
		knownMime &&
		getConfiguredMimeTypes().some(pattern => mimeMatchesPattern(knownMime, pattern))
	) {
		return false;
	}

	const textOnly = getConfiguration<boolean>('bulk-text-only') ?? true;
	if (!textOnly) {
		return true;
	}

	const isBinary = await looksBinary(uri);
	if (isBinary) {
		return false;
	}

	return !isExcludedByMimeType(filePath, false);
}

export async function filterProcessableFiles(uris: Uri[]): Promise<Uri[]> {
	const kept: Uri[] = [];
	for (const uri of uris) {
		if (await shouldProcessFile(uri)) {
			kept.push(uri);
		}
	}
	return kept;
}
