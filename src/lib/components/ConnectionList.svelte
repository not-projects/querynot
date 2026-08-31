<script lang="ts">
  import type { ConnectionInfoView, ProfileView } from '../generated/contracts';
  import ActionMenu, { type ActionMenuItem } from './ActionMenu.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    profiles: ProfileView[];
    activeProfileId: string | null;
    offlineActive: boolean;
    connections: Record<string, ConnectionInfoView>;
    connectionOperations: Record<string, 'test' | 'connect'>;
    onselectprofile: (profile: ProfileView) => void;
    onselectoffline: () => void;
    onconnect: (profile: ProfileView) => void;
    ondisconnect: (profile: ProfileView) => void;
    ontest: (profile: ProfileView) => void;
    oncancelconnection: (profile: ProfileView) => void;
    oneditprofile: (profile: ProfileView) => void;
    onduplicateprofile: (profile: ProfileView) => void;
    ondeleteprofile: (profile: ProfileView) => void;
  }

  let {
    profiles,
    activeProfileId,
    offlineActive,
    connections,
    connectionOperations,
    onselectprofile,
    onselectoffline,
    onconnect,
    ondisconnect,
    ontest,
    oncancelconnection,
    oneditprofile,
    onduplicateprofile,
    ondeleteprofile
  }: Props = $props();

  function profileEndpoint(profile: ProfileView) {
    return profile.kind === 'sqlite'
      ? (profile.file_name ?? 'Selected database file')
      : `${profile.host}:${profile.port}`;
  }

  function profileEngine(profile: ProfileView) {
    if (profile.kind === 'sqlite') return 'SQLite';
    if (profile.kind === 'postgres') return 'PostgreSQL';
    return 'MySQL';
  }

  function connectionState(profileId: string) {
    const operation = connectionOperations[profileId];
    if (operation === 'test') return 'Testing';
    if (operation === 'connect') return 'Connecting';
    return connections[profileId] ? 'Connected' : 'Offline';
  }

  function connectionStateAccessibleLabel(profileId: string) {
    const state = connectionState(profileId);
    return state === 'Testing' ? 'Testing connection' : state;
  }

  function profileActionItems(profile: ProfileView): ActionMenuItem[] {
    return [
      {
        id: 'test',
        label: 'Test connection',
        description: 'Open and close a temporary test.',
        icon: 'database',
        disabled: Boolean(connectionOperations[profile.id])
      },
      {
        id: 'edit',
        label: 'Edit connection…',
        description: 'Change the saved profile.',
        icon: 'edited'
      },
      {
        id: 'duplicate',
        label: 'Duplicate connection',
        description: 'Copy without saved credentials.',
        icon: 'copy'
      },
      {
        id: 'delete',
        label: 'Delete connection…',
        description: 'Review profile and local data.',
        icon: 'trash',
        danger: true,
        separatorBefore: true
      }
    ];
  }

  function selectProfileAction(profile: ProfileView, itemId: string) {
    if (itemId === 'test') ontest(profile);
    else if (itemId === 'edit') oneditprofile(profile);
    else if (itemId === 'duplicate') onduplicateprofile(profile);
    else if (itemId === 'delete') ondeleteprofile(profile);
  }
</script>

<nav class="connection-list" aria-label="Saved connections">
  {#each profiles as profile (profile.id)}
    <div
      class:active={activeProfileId === profile.id}
      class="connection-row"
      data-profile-id={profile.id}
    >
      <button
        type="button"
        class="connection-main"
        aria-pressed={activeProfileId === profile.id}
        onclick={() => onselectprofile(profile)}
      >
        <span class="profile-icon" aria-hidden="true">
          <Icon name="database" size={15} />
        </span>
        <span class="connection-copy">
          <strong title={profile.name}>{profile.name}</strong>
          <small title={profileEndpoint(profile)}>
            <span class="connection-endpoint">{profileEndpoint(profile)}</span>
            <span aria-hidden="true">·</span>
            <span class="engine-label">
              {profileEngine(profile)}
            </span>
          </small>
        </span>
      </button>

      <div class="connection-row-actions">
        <span
          class="connection-state"
          data-state={connectionState(profile.id).toLowerCase()}
          aria-label={connectionStateAccessibleLabel(profile.id)}
        >
          <span aria-hidden="true"></span>
          {connectionState(profile.id)}
        </span>
        <div class="connection-action-controls">
          {#if connectionOperations[profile.id]}
            <button
              type="button"
              class="connection-action"
              data-intent="cancel"
              aria-label={`Cancel ${connectionOperations[profile.id]} for ${profile.name}`}
              onclick={() => oncancelconnection(profile)}>Cancel</button
            >
          {:else if connections[profile.id]}
            <button
              type="button"
              class="connection-action"
              data-intent="disconnect"
              onclick={() => ondisconnect(profile)}>Disconnect</button
            >
          {:else}
            <button
              type="button"
              class="connection-action"
              data-intent="connect"
              onclick={() => onconnect(profile)}>Connect</button
            >
          {/if}

          <ActionMenu
            class="connection-profile-menu"
            label={`More actions for ${profile.name}`}
            menuLabel={`Actions for ${profile.name}`}
            heading={profile.name}
            meta={`${connectionState(profile.id)} · ${profileEngine(profile)}`}
            items={profileActionItems(profile)}
            onselect={(itemId) => selectProfileAction(profile, itemId)}
          />
        </div>
      </div>
    </div>
  {/each}

  <div
    class:active={offlineActive}
    class="connection-row offline-row"
    data-profile-id="offline"
  >
    <button
      type="button"
      class="connection-main"
      aria-pressed={offlineActive}
      onclick={onselectoffline}
    >
      <span class="profile-icon offline-mark" aria-hidden="true"
        ><Icon name="offline" size={15} /></span
      >
      <span class="connection-copy">
        <strong>Offline</strong>
        <small>Local files and drafts</small>
      </span>
    </button>
  </div>
</nav>

<style>
  .connection-list {
    display: grid;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    align-content: start;
    grid-auto-rows: max-content;
    margin-block: 0.35rem 0;
    gap: 0.15rem;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .connection-row {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 3.1rem;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.2rem;
    padding: 0.12rem;
    border: 1px solid transparent;
    border-radius: 4px;
  }

  .connection-row:hover,
  .connection-row:focus-within {
    background: color-mix(in srgb, var(--surface-raised) 64%, transparent);
  }

  .connection-row.active {
    border-color: transparent;
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-raised));
    box-shadow: inset 2px 0 var(--accent);
  }

  .connection-main {
    display: grid;
    min-width: 0;
    min-height: 2.55rem;
    grid-template-columns: 1.55rem minmax(0, 1fr);
    align-items: center;
    padding: 0.28rem 0.32rem;
    gap: 0.42rem;
    border: 0;
    text-align: left;
    background: transparent;
  }

  .connection-copy {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .connection-copy strong,
  .connection-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-copy strong {
    min-width: 0;
    flex: 1 1 auto;
    font-size: 0.75rem;
    line-height: 1.15;
  }

  .connection-copy small {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.24rem;
    color: var(--muted);
    font-size: 0.61rem;
  }

  .connection-endpoint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .engine-label {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--muted) 82%, var(--text));
    font-size: 0.54rem;
    font-weight: 700;
    letter-spacing: 0.035em;
    text-transform: uppercase;
  }

  .profile-icon {
    display: grid;
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 5px;
    color: var(--muted);
    background: color-mix(in srgb, var(--surface-raised) 72%, transparent);
  }

  .connection-state {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.25rem;
    color: var(--muted);
    font-size: 0.55rem;
    font-weight: 650;
  }

  .connection-state > span {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 50%;
    background: currentColor;
  }

  .connection-state[data-state='connected'],
  .connection-state[data-state='testing'],
  .connection-state[data-state='connecting'] {
    color: var(--accent);
  }

  .connection-state[data-state='testing'] > span,
  .connection-state[data-state='connecting'] > span {
    background: transparent;
    box-shadow: inset 0 0 0 1px currentColor;
  }

  .connection-row-actions {
    display: grid;
    justify-items: end;
    align-content: center;
    gap: 0.1rem;
  }

  .connection-action-controls {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }

  .connection-action {
    min-width: 3.55rem;
    min-height: 1.75rem;
    padding: 0.2rem 0.38rem;
    border-color: color-mix(in srgb, var(--divider) 78%, transparent);
    color: var(--muted);
    background: color-mix(in srgb, var(--surface-raised) 55%, transparent);
    font-size: 0.59rem;
    font-weight: 650;
  }

  .connection-action[data-intent='connect'] {
    color: var(--accent);
  }

  .offline-row {
    margin-block-start: 0.28rem;
    border-block-start-color: var(--divider);
    border-radius: 0 0 6px 6px;
  }

  .offline-mark {
    color: var(--muted);
    background: transparent;
  }
</style>
