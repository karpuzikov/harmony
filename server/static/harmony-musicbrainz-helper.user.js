// ==UserScript==
// @name         Harmony - MusicBrainz One-Click External ID Helper
// @namespace    https://harmony.pulsewidth.org.uk/
// @version      1.0.0
// @description  Lets Harmony submit seeded MusicBrainz external-ID edits quickly through one authenticated MusicBrainz bridge tab.
// @license      MIT
// @match        https://harmony.pulsewidth.org.uk/release/actions*
// @match        https://musicbrainz.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(() => {
	'use strict';

	const queueKey = 'harmony.musicbrainz.external-id-queue.v1';
	const bridgeParam = 'harmony_external_id_bridge';
	const maxConcurrentSubmissions = 4;
	const allowedTypes = new Set(['artist', 'label', 'recording']);

	function readQueue() {
		return GM_getValue(queueKey, null);
	}

	function writeQueue(queue) {
		queue.updatedAt = Date.now();
		GM_setValue(queueKey, queue);
	}

	function parseEditLink(rawUrl) {
		try {
			const url = new URL(rawUrl);
			if (url.origin !== 'https://musicbrainz.org') return null;

			const match = url.pathname.match(/^\/(artist|label|recording)\/([0-9a-f-]{36})\/edit$/i);
			if (!match) return null;

			const type = match[1].toLowerCase();
			if (!allowedTypes.has(type)) return null;

			return {
				url: url.href,
				type,
				mbid: match[2],
				state: 'pending',
				error: '',
			};
		} catch {
			return null;
		}
	}

	function bridgeUrl(jobId) {
		const url = new URL('https://musicbrainz.org/');
		url.searchParams.set(bridgeParam, jobId);
		return url.href;
	}

	function announceReady() {
		const root = document.documentElement;
		if (!root) {
			setTimeout(announceReady, 0);
			return;
		}

		root.dataset.harmonyMusicbrainzHelper = 'ready';
		document.dispatchEvent(new Event('harmony-musicbrainz-helper-ready'));
	}

	function relayStatusToHarmony() {
		const queue = readQueue();
		if (!queue || queue.sourceOrigin !== location.origin) return;

		const total = queue.items?.length || 0;
		let text = '';

		if (queue.status === 'running') {
			text = `${queue.completed}/${total} processed - ${queue.succeeded} submitted, ${queue.failed} failed...`;
		} else if (queue.status === 'complete') {
			text = queue.failed
				? `Done: ${queue.succeeded}/${total} submitted, ${queue.failed} failed.`
				: `Done: ${queue.succeeded}/${total} submitted.`;
		} else if (queue.status === 'failed') {
			text = `Stopped: ${queue.fatalError || 'MusicBrainz submission failed.'}`;
		}

		if (!text) return;
		window.postMessage({
			source: 'harmony-musicbrainz-helper',
			type: 'harmony-external-id-status',
			scope: queue.scope,
			text,
		}, location.origin);
	}

	function runHarmonySide() {
		announceReady();
		setInterval(relayStatusToHarmony, 350);

		window.addEventListener('message', (event) => {
			if (event.source !== window || event.origin !== location.origin) return;
			const data = event.data;
			if (
				typeof data !== 'object' ||
				data === null ||
				data.source !== 'harmony' ||
				data.type !== 'harmony-submit-external-id-edits' ||
				!Array.isArray(data.links)
			) {
				return;
			}

			const seen = new Set();
			const items = [];
			for (const rawUrl of data.links) {
				if (typeof rawUrl !== 'string') continue;
				const item = parseEditLink(rawUrl);
				if (!item) continue;

				const key = `${item.type}:${item.mbid}:${item.url}`;
				if (seen.has(key)) continue;
				seen.add(key);
				items.push(item);
			}

			if (!items.length) return;

			const scope = data.scope === 'all' || allowedTypes.has(data.scope)
				? data.scope
				: 'all';
			const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
			writeQueue({
				id: jobId,
				status: 'running',
				scope,
				items,
				completed: 0,
				succeeded: 0,
				failed: 0,
				fatalError: '',
				sourceOrigin: location.origin,
				startedAt: Date.now(),
				updatedAt: Date.now(),
			});

			relayStatusToHarmony();
			GM_openInTab(bridgeUrl(jobId), {
				active: false,
				insert: true,
				setParent: true,
			});
		});
	}

	function getBridgeJobId() {
		return new URL(location.href).searchParams.get(bridgeParam) || '';
	}

	function setBridgeStatus(text, isError = false) {
		document.title = `Harmony External IDs - ${text}`;

		let box = document.getElementById('harmony-external-id-bridge-status');
		if (!box) {
			box = document.createElement('div');
			box.id = 'harmony-external-id-bridge-status';
			box.style.cssText = [
				'position:fixed',
				'top:12px',
				'right:12px',
				'z-index:2147483647',
				'max-width:620px',
				'padding:12px 14px',
				'border-radius:6px',
				'font:14px/1.45 sans-serif',
				'box-shadow:0 2px 12px rgba(0,0,0,.25)',
				'white-space:pre-wrap',
			].join(';');
			document.documentElement.appendChild(box);
		}

		box.style.background = isError ? '#f8d7da' : '#d1e7dd';
		box.style.color = isError ? '#58151c' : '#0a3622';
		box.style.border = `1px solid ${isError ? '#f1aeb5' : '#a3cfbb'}`;
		box.textContent = text;
	}

	function findEditForm(doc, item) {
		const prefix = `edit-${item.type}.`;
		return [...doc.querySelectorAll('form')].find((form) => {
			const method = (form.getAttribute('method') || 'get').toLowerCase();
			return method === 'post' && [...form.elements].some((element) =>
				typeof element.name === 'string' && element.name.startsWith(prefix)
			);
		}) || null;
	}

	function formToUrlEncoded(form, item) {
		const params = new URLSearchParams();
		for (const [key, value] of new FormData(form).entries()) {
			if (typeof value === 'string') params.append(key, value);
		}

		const seededUrl = new URL(item.url);
		const prefix = `edit-${item.type}.url.`;
		for (const [key, value] of seededUrl.searchParams.entries()) {
			if (
				key.startsWith(prefix) &&
				(key.endsWith('.text') || key.endsWith('.link_type_id'))
			) {
				params.set(key, value);
			}
		}

		return params;
	}

	function extractErrors(doc) {
		const selectors = [
			'.error',
			'.errors',
			'.error-message',
			'.field-error',
			'.field-error-message',
			'.message.error',
		];
		const found = [];
		const seen = new Set();

		for (const selector of selectors) {
			for (const element of doc.querySelectorAll(selector)) {
				const text = element.textContent.replace(/\s+/g, ' ').trim();
				if (!text || seen.has(text)) continue;
				seen.add(text);
				found.push(text);
				if (found.length >= 4) return found.join(' | ');
			}
		}

		return found.join(' | ');
	}

	function loginRequired(response) {
		try {
			return new URL(response.url).pathname.startsWith('/login');
		} catch {
			return false;
		}
	}

	async function submitItem(item) {
		const getResponse = await fetch(item.url, {
			method: 'GET',
			credentials: 'include',
			cache: 'no-store',
			redirect: 'follow',
			headers: {
				Accept: 'text/html,application/xhtml+xml',
			},
		});

		if (getResponse.status === 401 || getResponse.status === 403 || loginRequired(getResponse)) {
			const error = new Error('MusicBrainz login is required.');
			error.fatal = true;
			throw error;
		}
		if (!getResponse.ok) {
			throw new Error(`MusicBrainz GET failed with HTTP ${getResponse.status}.`);
		}

		const getHtml = await getResponse.text();
		const getDoc = new DOMParser().parseFromString(getHtml, 'text/html');
		const form = findEditForm(getDoc, item);
		if (!form) {
			throw new Error(
				extractErrors(getDoc) || `Could not find the MusicBrainz ${item.type} edit form.`
			);
		}

		const body = formToUrlEncoded(form, item);
		const prefix = `edit-${item.type}.url.`;
		const textFields = [...body.keys()].filter(
			(key) => key.startsWith(prefix) && key.endsWith('.text')
		);
		const typeFields = [...body.keys()].filter(
			(key) => key.startsWith(prefix) && key.endsWith('.link_type_id')
		);
		if (!textFields.length || textFields.length !== typeFields.length) {
			throw new Error(
				`Harmony did not provide a complete MusicBrainz ${item.type} external-link payload.`
			);
		}

		const action = new URL(form.getAttribute('action') || getResponse.url, getResponse.url);
		action.hash = '';

		const postResponse = await fetch(action.href, {
			method: 'POST',
			credentials: 'include',
			cache: 'no-store',
			redirect: 'follow',
			headers: {
				Accept: 'text/html,application/xhtml+xml',
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
			},
			body: body.toString(),
		});

		if (postResponse.status === 401 || postResponse.status === 403 || loginRequired(postResponse)) {
			const error = new Error('MusicBrainz login is required.');
			error.fatal = true;
			throw error;
		}

		const postHtml = await postResponse.text();
		const postDoc = new DOMParser().parseFromString(postHtml, 'text/html');
		const finalUrl = new URL(postResponse.url);
		const stillOnEditPage = /^\/(artist|label|recording)\/[0-9a-f-]{36}\/edit$/i.test(finalUrl.pathname);

		if (!postResponse.ok || stillOnEditPage || !postResponse.redirected) {
			throw new Error(
				extractErrors(postDoc) ||
				`MusicBrainz did not confirm the ${item.type} edit submission (HTTP ${postResponse.status}).`
			);
		}
	}

	async function runBridge() {
		const jobId = getBridgeJobId();
		if (!jobId) return;

		const queue = readQueue();
		if (!queue || queue.id !== jobId || queue.status !== 'running') {
			setBridgeStatus('No active Harmony submission job was found.', true);
			return;
		}

		setBridgeStatus(`Starting: 0/${queue.items.length} processed`);
		let cursor = 0;
		let fatalError = null;

		const saveProgress = () => {
			queue.completed = queue.succeeded + queue.failed;
			writeQueue(queue);
			setBridgeStatus(
				`${queue.completed}/${queue.items.length} processed - ${queue.succeeded} submitted, ${queue.failed} failed`
			);
		};

		async function worker() {
			while (!fatalError) {
				const index = cursor++;
				if (index >= queue.items.length) return;

				const item = queue.items[index];
				item.state = 'submitting';
				writeQueue(queue);

				try {
					await submitItem(item);
					item.state = 'submitted';
					item.error = '';
					queue.succeeded += 1;
				} catch (error) {
					item.state = 'failed';
					item.error = error?.message || String(error);
					queue.failed += 1;
					if (error?.fatal) fatalError = item.error;
				}

				saveProgress();
			}
		}

		const workerCount = Math.min(maxConcurrentSubmissions, queue.items.length);
		await Promise.all(Array.from({ length: workerCount }, () => worker()));

		if (fatalError) {
			queue.status = 'failed';
			queue.fatalError = fatalError;
			writeQueue(queue);
			setBridgeStatus(`Stopped: ${fatalError}`, true);
			return;
		}

		queue.status = 'complete';
		writeQueue(queue);

		if (queue.failed) {
			const failures = queue.items
				.filter((item) => item.state === 'failed')
				.map((item) => `${item.type} ${item.mbid}: ${item.error}`)
				.join('\n');
			setBridgeStatus(
				`Finished: ${queue.succeeded}/${queue.items.length} submitted, ${queue.failed} failed.\n\n${failures}`,
				true
			);
			return;
		}

		setBridgeStatus(`Finished: ${queue.succeeded}/${queue.items.length} submitted.`);
		setTimeout(() => window.close(), 750);
	}

	if (location.hostname === 'harmony.pulsewidth.org.uk') {
		runHarmonySide();
	} else if (location.hostname === 'musicbrainz.org' && getBridgeJobId()) {
		runBridge().catch((error) => {
			const queue = readQueue();
			if (queue) {
				queue.status = 'failed';
				queue.fatalError = error?.message || String(error);
				writeQueue(queue);
			}
			setBridgeStatus(error?.message || String(error), true);
		});
	}
})();
