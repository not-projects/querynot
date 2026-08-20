<script lang="ts">
  import type {
    ConnectionInfoView,
    ProfileView,
    SessionView,
    WorkspaceTabView
  } from '../generated/contracts';

  interface Props {
    profiles: ProfileView[];
    tabs: WorkspaceTabView[];
    activeTabId: string | null;
    connections: Record<string, ConnectionInfoView>;
    connectionOperations: Record<string, 'test' | 'connect'>;
    sessions: Record<string, SessionView>;
    sessionOpening: Record<string, boolean>;
    sessionErrors: Record<string, string>;
    expandedProfiles: Record<string, boolean>;
    offlineExpanded: boolean;
    onselectprofile: (profile: ProfileView) => void;
    onselectoffline: () => void;
    ontoggleprofile: (profileId: string) => void;
    ontoggleoffline: () => void;
    onnewquery: (profileId: string | null) => void;
    onconnect: (profile: ProfileView) => void;
    ondisconnect: (profile: ProfileView) => void;
    ontest: (profile: ProfileView) => void;
    oncancelconnection: (profile: ProfileView) => void;
    oneditprofile: (profile: ProfileView) => void;
    onduplicateprofile: (profile: ProfileView) => void;
    ondeleteprofile: (profile: ProfileView) => void;
    onactivatetab: (tab: WorkspaceTabView) => void;
    onclosetab: (tab: WorkspaceTabView) => void;
    onrenametab: (tab: WorkspaceTabView, title: string) => void;
    onduplicatetab: (tab: WorkspaceTabView) => void;
    onpintab: (tab: WorkspaceTabView) => void;
    onmovetab: (tab: WorkspaceTabView, direction: -1 | 1) => void;
  }

  let {
    profiles,
    tabs,
    activeTabId,
    connections,
    connectionOperations,
    sessions,
    sessionOpening,
    sessionErrors,
    expandedProfiles,
    offlineExpanded,
    onselectprofile,
    onselectoffline,
    ontoggleprofile,
    ontoggleoffline,
    onnewquery,
    onconnect,
    ondisconnect,
    ontest,
    oncancelconnection,
    oneditprofile,
    onduplicateprofile,
    ondeleteprofile,
    onactivatetab,
    onclosetab,
    onrenametab,
    onduplicatetab,
    onpintab,
    onmovetab
  }: Props = $props();

  const offlineTabs = $derived(tabs.filter((tab) => tab.profile_id === null));

  function profileTabs(profileId: string) {
    return tabs.filter((tab) => tab.profile_id === profileId);
  }

  function sessionLabel(tab: WorkspaceTabView) {
    if (sessionOpening[tab.id]) return 'Opening dedicated session';
    if (sessions[tab.id]) return 'Dedicated session online';
    if (sessionErrors[tab.id]) return 'Session open failed';
    return tab.profile_id ? 'Tab offline' : 'Offline draft';
  }
</script>

{#snippet tabRow(tab: WorkspaceTabView)}
  <div class:active={activeTabId === tab.id} class="connection-tab-row">
    <button
      type="button"
      class="connection-tab-main"
      role="tab"
      aria-selected={activeTabId === tab.id}
      tabindex={activeTabId === tab.id ? 0 : -1}
      onclick={() => onactivatetab(tab)}
    >
      <span class="tab-title" title={tab.title}>{tab.title}</span>
      <span class="tab-indicators">
        {#if tab.pinned}<span aria-label="Pinned tab">◆</span>{/if}
        {#if tab.kind === 'table_data'}<span aria-label="Table-data tab">▦</span
          >{/if}
        {#if tab.dirty}<span aria-label="Unsaved draft">●</span>{/if}
        <span
          class:online={Boolean(sessions[tab.id])}
          class:error={Boolean(sessionErrors[tab.id])}
          class:opening={Boolean(sessionOpening[tab.id])}
          class="tab-session"
          title={sessionLabel(tab)}
          aria-label={sessionLabel(tab)}
          >{sessionOpening[tab.id]
            ? '◌'
            : sessions[tab.id]
              ? '●'
              : sessionErrors[tab.id]
                ? '!'
                : '○'}</span
        >
      </span>
    </button>
    <details class="tab-overflow">
      <summary aria-label={`More actions for ${tab.title}`}>⋯</summary>
      <div>
        <label>
          <span>Rename</span>
          <input
            value={tab.title}
            maxlength="256"
            aria-label={`Rename ${tab.title}`}
            onchange={(event) =>
              onrenametab(tab, (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <button type="button" onclick={() => onpintab(tab)}
          >{tab.pinned ? 'Unpin' : 'Pin'}</button
        >
        {#if tab.kind === 'query'}
          <button type="button" onclick={() => onduplicatetab(tab)}
            >Duplicate</button
          >
        {/if}
        <button type="button" onclick={() => onmovetab(tab, -1)}>Move up</button
        >
        <button type="button" onclick={() => onmovetab(tab, 1)}
          >Move down</button
        >
      </div>
    </details>
    <button
      type="button"
      class="tab-close"
      aria-label={`Close ${tab.title}`}
      onclick={() => onclosetab(tab)}>×</button
    >
  </div>
{/snippet}

<nav class="connection-groups" aria-label="Connection-grouped tabs">
  {#each profiles as profile (profile.id)}
    {@const children = profileTabs(profile.id)}
    <section class="connection-group" data-profile-id={profile.id}>
      <div class="connection-group-row">
        <button
          type="button"
          class="group-toggle"
          aria-label={`${expandedProfiles[profile.id] ? 'Collapse' : 'Expand'} ${profile.name}`}
          aria-expanded={Boolean(expandedProfiles[profile.id])}
          onclick={() => ontoggleprofile(profile.id)}
          >{expandedProfiles[profile.id] ? '▾' : '▸'}</button
        >
        <button
          type="button"
          class="group-main"
          onclick={() => onselectprofile(profile)}
        >
          <span class="engine-mark" aria-hidden="true">
            {profile.kind === 'sqlite' ? 'SQ' : 'MY'}
          </span>
          <span>
            <strong>{profile.name}</strong>
            <small>
              {profile.kind === 'sqlite'
                ? profile.file_name
                : `${profile.host}:${profile.port}`}
            </small>
          </span>
          <span
            class:connected={Boolean(connections[profile.id])}
            class="connection-status"
            aria-label={connections[profile.id] ? 'Connected' : 'Offline'}
            title={connections[profile.id] ? 'Connected' : 'Offline'}
          ></span>
        </button>
        {#if connectionOperations[profile.id]}
          <span class="operation-status" role="status">
            {connectionOperations[profile.id] === 'test'
              ? 'Testing…'
              : 'Connecting…'}
          </span>
          <button
            type="button"
            class="connection-control"
            onclick={() => oncancelconnection(profile)}>Cancel</button
          >
        {:else if connections[profile.id]}
          <button
            type="button"
            class="connection-control"
            onclick={() => ondisconnect(profile)}>Disconnect</button
          >
        {:else}
          <button
            type="button"
            class="connection-control"
            onclick={() => onconnect(profile)}>Connect</button
          >
        {/if}
        <button
          type="button"
          class="new-query"
          aria-label={`New query for ${profile.name}`}
          onclick={() => onnewquery(profile.id)}>+</button
        >
        <details class="profile-overflow">
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
      {#if expandedProfiles[profile.id]}
        <div
          class="connection-tabs"
          role="tablist"
          aria-label={`${profile.name} tabs`}
        >
          {#each children as tab (tab.id)}
            {@render tabRow(tab)}
          {:else}
            <p>No tabs yet. Use + to start a query.</p>
          {/each}
        </div>
      {/if}
    </section>
  {/each}

  <section class="connection-group offline-group">
    <div class="connection-group-row">
      <button
        type="button"
        class="group-toggle"
        aria-label={`${offlineExpanded ? 'Collapse' : 'Expand'} Offline`}
        aria-expanded={offlineExpanded}
        onclick={ontoggleoffline}>{offlineExpanded ? '▾' : '▸'}</button
      >
      <button
        type="button"
        class="group-main offline-main"
        onclick={onselectoffline}
      >
        <span class="engine-mark" aria-hidden="true">—</span>
        <span
          ><strong>Offline</strong><small>SQL files and detached drafts</small
          ></span
        >
        <span class="connection-status" aria-label="Offline"></span>
      </button>
      <button
        type="button"
        class="new-query"
        aria-label="New offline query"
        onclick={() => onnewquery(null)}>+</button
      >
    </div>
    {#if offlineExpanded}
      <div class="connection-tabs" role="tablist" aria-label="Offline tabs">
        {#each offlineTabs as tab (tab.id)}
          {@render tabRow(tab)}
        {:else}
          <p>No offline drafts.</p>
        {/each}
      </div>
    {/if}
  </section>
</nav>

<style>
  .connection-groups {
    display: grid;
    gap: 0.35rem;
  }

  .connection-group {
    min-width: 0;
    border-block-end: 1px solid var(--divider);
  }

  .connection-group-row,
  .connection-tab-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.2rem;
  }

  .connection-group-row {
    min-height: 2.3rem;
  }

  .group-toggle,
  .new-query,
  .tab-close,
  summary {
    display: grid;
    width: 1.8rem;
    min-width: 1.8rem;
    min-height: 1.8rem;
    padding: 0;
    place-items: center;
    border: 0;
    background: transparent;
  }

  .group-main,
  .connection-tab-main {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem;
    text-align: left;
    border: 0;
    background: transparent;
  }

  .group-main > span:nth-child(2) {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  strong,
  small,
  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--muted);
    font-size: 0.67rem;
  }

  .engine-mark {
    display: grid;
    width: 1.65rem;
    height: 1.65rem;
    flex: 0 0 auto;
    place-items: center;
    color: var(--accent-contrast);
    font-size: 0.58rem;
    font-weight: 700;
    border-radius: 5px;
    background: var(--accent);
  }

  .connection-status {
    width: 0.5rem;
    height: 0.5rem;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--muted);
  }

  .connection-status.connected,
  .tab-session.online {
    background: var(--success);
  }

  .connection-control {
    min-height: 1.8rem;
    padding: 0.2rem 0.38rem;
    font-size: 0.66rem;
  }

  .operation-status {
    max-width: 4.5rem;
    overflow: hidden;
    color: var(--muted);
    font-size: 0.62rem;
    text-overflow: ellipsis;
  }

  .connection-tabs {
    display: grid;
    padding: 0 0 0.35rem 1.8rem;
    gap: 0.15rem;
  }

  .connection-tabs > p {
    margin: 0;
    padding: 0.3rem;
    color: var(--muted);
    font-size: 0.68rem;
  }

  .connection-tab-row {
    min-height: 1.9rem;
    border-radius: 5px;
  }

  .connection-tab-row.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .connection-tab-main {
    padding-inline: 0.45rem;
    font-size: 0.72rem;
  }

  .tab-indicators {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.58rem;
  }

  .tab-session {
    display: inline-grid;
    width: 0.8rem;
    height: 0.8rem;
    place-items: center;
  }

  .tab-session.online {
    color: var(--success);
    background: transparent;
  }

  .tab-session.error {
    color: var(--danger);
    font-weight: 700;
  }

  .tab-session.opening {
    color: var(--accent);
  }

  details {
    position: relative;
  }

  summary {
    list-style: none;
    cursor: pointer;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  details > div {
    position: absolute;
    z-index: 20;
    top: calc(100% + 2px);
    right: 0;
    display: grid;
    width: 10rem;
    padding: 0.4rem;
    gap: 0.25rem;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  details button,
  details label {
    width: 100%;
  }

  details label {
    display: grid;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.65rem;
  }

  details input {
    min-width: 0;
    width: 100%;
  }

  .offline-group {
    margin-block-start: 0.2rem;
  }

  .offline-main .engine-mark {
    color: var(--muted);
    background: var(--surface-raised);
    border: 1px solid var(--divider);
  }

  @media (max-width: 1100px) {
    .connection-control {
      width: 1.8rem;
      overflow: hidden;
      color: transparent;
    }

    .connection-control::first-letter {
      color: var(--text);
    }
  }
</style>
