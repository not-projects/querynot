<script lang="ts">
  const actions = [
    {
      label: 'Create connection',
      description: 'Set up SQLite, MySQL, or MariaDB manually.'
    },
    {
      label: 'Open SQLite file',
      description: 'Choose one database file without scanning your device.'
    },
    {
      label: 'Open SQL file offline',
      description: 'Open text without connecting or executing it.'
    }
  ] as const;

  let theme = $state<'light' | 'dark' | 'forest'>('light');
  let statusMessage = $state('No database connection is active.');

  function chooseAction(label: string) {
    statusMessage = `${label} is planned for the secure local foundation phase.`;
  }
</script>

<svelte:head>
  <meta
    name="description"
    content="QueryNot is a local-first desktop SQL client for everyday developer workflows."
  />
</svelte:head>

<svelte:window
  onkeydown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === '1') {
      event.preventDefault();
      document.getElementById('connections-heading')?.focus();
    }
  }}
/>

<div class="app-shell" data-theme={theme}>
  <header class="topbar">
    <div>
      <p class="eyebrow">Not Projects</p>
      <h1>QueryNot</h1>
    </div>
    <label class="theme-control">
      <span>Theme</span>
      <select bind:value={theme} aria-label="Theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="forest">Forest</option>
      </select>
    </label>
  </header>

  <div class="workbench">
    <aside aria-labelledby="connections-heading">
      <div class="pane-heading">
        <h2 id="connections-heading" tabindex="-1">Connections</h2>
        <button
          type="button"
          aria-label="Create connection"
          onclick={() => chooseAction('Create connection')}
        >
          +
        </button>
      </div>
      <p class="muted">No saved profiles</p>
    </aside>

    <main>
      <div class="context-bar" aria-label="Active query context">
        <span>Offline</span>
        <span>No profile</span>
        <span>Auto-commit</span>
        <span>Idle</span>
      </div>

      <section class="empty-state" aria-labelledby="welcome-heading">
        <p class="eyebrow">Local-first SQL workbench</p>
        <h2 id="welcome-heading">Query your data, not your patience.</h2>
        <p>
          QueryNot does not scan for databases or reconnect automatically.
          Choose the exact local file or authorized server you intend to use.
        </p>
        <div class="action-list">
          {#each actions as action (action.label)}
            <button type="button" onclick={() => chooseAction(action.label)}>
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </button>
          {/each}
          <button type="button" onclick={() => chooseAction('Settings')}>
            <strong>Settings</strong>
            <span>Review local data, appearance, and safety defaults.</span>
          </button>
        </div>
      </section>
    </main>
  </div>

  <footer aria-live="polite">{statusMessage}</footer>
</div>
