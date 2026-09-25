import { Button } from '@/server/components/Button.tsx';
import { SpriteIcon } from '@/server/components/SpriteIcon.tsx';

import type { EntityType } from '@kellnerd/musicbrainz/data/entity';
import { useSignal } from '@preact/signals';
import { IS_BROWSER } from 'fresh/runtime.ts';
import { useEffect } from 'preact/hooks';

export type ExternalIdSubmissionScope = EntityType | 'all';

const helperInstallUrl = '/harmony-musicbrainz-helper.user.js';
const helperReadyEvent = 'harmony-musicbrainz-helper-ready';
const helperMarker = 'harmonyMusicbrainzHelper';

export function SubmitExternalLinks({ links, scope, label }: {
	links: string[];
	scope: ExternalIdSubmissionScope;
	label: string;
}) {
	const helperReady = useSignal(
		IS_BROWSER && document.documentElement.dataset[helperMarker] === 'ready',
	);
	const status = useSignal('');

	useEffect(() => {
		const markReady = () => {
			helperReady.value = true;
		};
		const handleMessage = (event: MessageEvent) => {
			if (event.source !== window || event.origin !== window.location.origin) return;
			const data = event.data;
			if (
				typeof data !== 'object' ||
				data === null ||
				data.source !== 'harmony-musicbrainz-helper' ||
				data.scope !== scope
			) {
				return;
			}

			if (data.type === 'harmony-external-id-status' && typeof data.text === 'string') {
				status.value = data.text;
			}
		};

		document.addEventListener(helperReadyEvent, markReady);
		window.addEventListener('message', handleMessage);
		return () => {
			document.removeEventListener(helperReadyEvent, markReady);
			window.removeEventListener('message', handleMessage);
		};
	}, [scope]);

	if (!links.length) return null;

	// Only the global control shows the helper installation prompt. The
	// type-specific controls stay hidden until the helper is available.
	if (!helperReady.value && scope !== 'all') {
		return <span hidden data-external-id-helper-placeholder />;
	}

	function submitExternalLinks() {
		if (!helperReady.value) return;
		status.value = `Starting 0/${links.length}...`;
		window.postMessage({
			source: 'harmony',
			type: 'harmony-submit-external-id-edits',
			scope,
			links,
		}, window.location.origin);
	}

	return (
		<div class='action'>
			<SpriteIcon name='external-link' />
			<div>
				<p>
					{helperReady.value
						? (
							<Button
								class='open-all-links'
								onClick={submitExternalLinks}
								title={`Submit ${links.length} MusicBrainz external ID edit${links.length === 1 ? '' : 's'}`}
							>
								{label}
							</Button>
						)
						: (
							<>
								<a href={helperInstallUrl}>Install the MusicBrainz one-click helper</a>
								{' to enable fast external ID submission'}
							</>
						)}
				</p>
				{status.value && <p class='submission-status'>{status.value}</p>}
			</div>
		</div>
	);
}
