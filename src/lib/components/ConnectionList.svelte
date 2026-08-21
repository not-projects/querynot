<script lang="ts">
  import type { ConnectionInfoView, ProfileView } from '../generated/contracts';

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
        <span class="engine-mark" aria-hidden="true">
          {profile.kind === 'sqlite' ? 'SQ' : 'MY'}
        </span>
        <span class="connection-copy">
          <strong title={profile.name}>{profile.name}</strong>
          <small
            title={profile.kind === 'sqlite'
              ? (profile.file_name ?? 'Selected database file')
              : `${profile.host}:${profile.port}`}
          >
            {profile.kind === 'sqlite'
              ? (profile.file_name ?? 'Selected database file')
              : `${profile.host}:${profile.port}`}
          </small>
        </span>
        <span
          class:connected={Boolean(connections[profile.id])}
          class:working={Boolean(connectionOperations[profile.id])}
          class="connection-status"
          aria-label={connectionOperations[profile.id]
            ? connectionOperations[profile.id] === 'test'
              ? 'Testing connection'
              : 'Connecting'
            : connections[profile.id]
              ? 'Connected'
              : 'Offline'}
          title={connectionOperations[profile.id]
            ? connectionOperations[profile.id] === 'test'
              ? 'Testing connection'
              : 'Connecting'
            : connections[profile.id]
              ? 'Connected'
              : 'Offline'}
        ></span>
      </button>

      {#if connectionOperations[profile.id]}
        <button
          type="button"
          class="connection-action"
          aria-label={`Cancel ${connectionOperations[profile.id]} for ${profile.name}`}
          onclick={() => oncancelconnection(profile)}>Cancel</button
        >
      {:else if connections[profile.id]}
        <button
          type="button"
          class="connection-action"
          onclick={() => ondisconnect(profile)}>Disconnect</button
        >
      {:else}
        <button
          type="button"
          class="connection-action"
          onclick={() => onconnect(profile)}>Connect</button
        >
      {/if}

      <details class="connection-overflow">
        <summary aria-label={`More actions for ${profile.name}`}>⋯</summary>
        <div>
          <button type="button" onclick={() => ontest(profile)}>Test</button>
          <button type="button" onclick={() => oneditprofile(profile)}
            >Edit</button
          >
          <button type="button" onclick={() => onduplicateprofile(profile)}
            >Duplicate</button
          >
          <button type="button" onclick={() => ondeleteprofile(profile)}
            >Delete</button
          >
        </div>
      </details>
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
      <span class="engine-mark offline-mark" aria-hidden="true">—</span>
      <span class="connection-copy">
        <strong>Offline</strong>
        <small>SQL files and detached drafts</small>
      </span>
      <span
        class="connection-status"
        aria-label="Offline workspace"
        title="Offline workspace"
      ></span>
    </button>
  </div>
</nav>

<style>
  .connection-list {
    display: grid;
    min-width: 0;
    margin-block: 0.65rem 0.25rem;
    gap: 0.22rem;
  }

  .connection-row {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 2.65rem;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.15rem;
    padding: 0.15rem;
    border: 1px solid transparent;
    border-radius: 4px;
  }

  .connection-row:hover,
  .connection-row:focus-within {
    background: color-mix(in srgb, var(--surface-raised) 58%, transparent);
  }

  .connection-row.active {
    border-color: transparent;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-raised));
    box-shadow: inset 2px 0 var(--accent);
  }

  .connection-main {
    display: grid;
    min-width: 0;
    min-height: 2.3rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    padding: 0.25rem 0.3rem;
    gap: 0.45rem;
    border: 0;
    text-align: left;
    background: transparent;
  }

  .connection-copy {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .connection-copy strong,
  .connection-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-copy strong {
    font-size: 0.76rem;
  }

  .connection-copy small {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .engine-mark {
    display: grid;
    width: 1.65rem;
    height: 1.65rem;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--divider));
    border-radius: 4px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    font-size: 0.54rem;
    font-weight: 800;
  }

  .connection-status {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--muted);
  }

  .connection-status.connected {
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .connection-status.working {
    border: 1px solid var(--accent);
    background: transparent;
  }

  .connection-action {
    min-width: 3.7rem;
    min-height: 1.75rem;
    padding: 0.2rem 0.4rem;
    border-color: transparent;
    color: var(--muted);
    background: transparent;
    font-size: 0.62rem;
  }

  details {
    position: relative;
  }

  summary {
    display: grid;
    width: 1.75rem;
    min-width: 1.75rem;
    min-height: 1.8rem;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
    list-style: none;
    cursor: pointer;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  details > div {
    position: absolute;
    z-index: 30;
    top: calc(100% + 2px);
    right: 0;
    display: grid;
    width: 9rem;
    padding: 0.4rem;
    gap: 0.2rem;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  details button {
    width: 100%;
    min-height: 1.8rem;
    text-align: left;
  }

  .offline-row {
    margin-block-start: 0.35rem;
    border-block-start-color: var(--divider);
    border-radius: 0 0 6px 6px;
  }

  .offline-mark {
    color: var(--muted);
    border: 1px solid var(--divider);
    background: var(--surface-raised);
  }
</style>
