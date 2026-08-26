import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const queryNotBrowserTemp = resolve(root, '.tmp', 'ui-layout-browser');
mkdirSync(queryNotBrowserTemp, { recursive: true });
process.env.TMPDIR = queryNotBrowserTemp;
process.env.TEMP = queryNotBrowserTemp;
process.env.TMP = queryNotBrowserTemp;
const { chromium } = await import('playwright');
const reportPath = resolve(root, 'artifacts', 'ui-layout-report.json');
const screenshotPath = resolve(root, 'artifacts', 'ui-layout-settings.png');
const settingsUpdatesScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-settings-updates.png'
);
const highScaleSettingsScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-settings-200.png'
);
const connectionServerScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-connection-server.png'
);
const connectionSecurityScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-connection-security.png'
);
const connectionFileScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-connection-file.png'
);
const highScaleConnectionScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-connection-200.png'
);
const workbenchScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-workbench.png'
);
const sidebarScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-sidebar.png'
);
const connectionMenuScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-connection-menu.png'
);
const schemaMenuScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-schema-menu.png'
);
const largeScaleWorkbenchScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-workbench-150.png'
);
const schemaStructureScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-schema-150.png'
);
const autocompleteScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-autocomplete.png'
);
const historyScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-history.png'
);
const historyDrawerScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-history-drawer.png'
);
const valueViewerScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-value-viewer.png'
);
const rowSelectionScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-row-selection.png'
);
const compactWorkbenchScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-workbench-720.png'
);
const headerScreenshotPath = resolve(root, 'artifacts', 'ui-layout-header.png');
const widths = [2048, 1280, 960, 720];
const themes = ['system', 'light', 'dark', 'forest'];

const git = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
});
if (git.status !== 0 || !/^[a-f0-9]{40}\n?$/.test(git.stdout)) {
  throw new Error('UI layout evidence requires an exact source commit');
}
const sourceCommit = git.stdout.trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 }
});
let browser;

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not expose a local TCP port');
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: widths[0], height: 1068 },
    reducedMotion: 'reduce'
  });
  await page.goto(`http://127.0.0.1:${address.port}`, {
    waitUntil: 'networkidle'
  });

  const layouts = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1068 });
    const layout = await page.evaluate(() => {
      const workbench = document
        .querySelector('.workbench')
        ?.getBoundingClientRect();
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      if (!workbench || !footer)
        throw new Error('workbench layout is incomplete');
      return {
        viewport_width: window.innerWidth,
        document_scroll_width: document.documentElement.scrollWidth,
        workbench_bottom: workbench.bottom,
        footer_top: footer.top,
        footer_bottom: footer.bottom,
        footer_height: footer.height
      };
    });
    assert(
      layout.document_scroll_width <= layout.viewport_width,
      `${width}px layout has page-level horizontal overflow`
    );
    assert(layout.footer_height <= 40, `${width}px status bar is stretched`);
    assert(
      Math.abs(layout.footer_bottom - 1068) < 1,
      `${width}px status bar is not pinned to the viewport bottom`
    );
    assert(
      layout.workbench_bottom <= layout.footer_top,
      `${width}px workbench overlaps the status bar`
    );
    layouts.push(layout);
  }

  await page.setViewportSize({ width: widths[0], height: 1068 });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const options = await page
    .locator('.modal-card select')
    .first()
    .locator('option')
    .allTextContents();
  assert(
    JSON.stringify(options) ===
      JSON.stringify(['System', 'Light', 'Dark', 'Forest']),
    'theme names do not match PostNot'
  );

  const settingsHierarchy = await page
    .locator('.settings-dialog')
    .evaluate((element) => {
      const bounds = (selector) => {
        const target = element.querySelector(selector);
        if (!target) throw new Error(`settings ${selector} is missing`);
        return target.getBoundingClientRect().toJSON();
      };
      const columns = element.querySelector('.settings-columns');
      return {
        headings: Array.from(
          element.querySelectorAll('.settings-section h3')
        ).map((heading) => heading.textContent?.trim() ?? ''),
        column_tracks: columns
          ? getComputedStyle(columns).gridTemplateColumns.split(' ').length
          : 0,
        card: element.getBoundingClientRect().toJSON(),
        header: bounds('.settings-header'),
        content: bounds('.settings-scroll'),
        footer: bounds('.settings-footer'),
        save: bounds('button[type="submit"]')
      };
    });
  assert(
    JSON.stringify(settingsHierarchy.headings) ===
      JSON.stringify([
        'Appearance',
        'Editor & formatting',
        'Results & tables',
        'Connections & recovery',
        'History & diagnostics',
        'Signed application updates'
      ]),
    `Settings hierarchy is incomplete (${JSON.stringify(settingsHierarchy.headings)})`
  );
  assert(
    settingsHierarchy.column_tracks === 2,
    `wide Settings did not render two preference columns (${settingsHierarchy.column_tracks})`
  );
  assert(
    settingsHierarchy.header.bottom <= settingsHierarchy.content.top + 1 &&
      settingsHierarchy.content.bottom <= settingsHierarchy.footer.top + 1 &&
      settingsHierarchy.save.bottom <= settingsHierarchy.card.bottom + 1,
    'Settings header, scroll region, and persistent actions overlap'
  );

  const dialogThemes = [];
  for (const theme of themes) {
    await page.locator('.modal-card select').first().selectOption(theme);
    const dialog = await page.locator('.modal-card').evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const select = element.querySelector('select');
      const option = select?.querySelector('option');
      if (!select || !option)
        throw new Error('settings theme select is missing');
      const selectStyle = getComputedStyle(select);
      const optionStyle = getComputedStyle(option);
      return {
        background_color: style.backgroundColor,
        color: style.color,
        select_background_color: selectStyle.backgroundColor,
        select_color: selectStyle.color,
        option_background_color: optionStyle.backgroundColor,
        option_color: optionStyle.color,
        inside_theme_context: Boolean(element.closest('.theme-context')),
        width: rect.width,
        height: rect.height
      };
    });
    assert(
      dialog.inside_theme_context,
      `${theme} dialog escaped the themed overlay context`
    );
    assert(
      !['rgba(0, 0, 0, 0)', 'transparent'].includes(dialog.background_color),
      `${theme} dialog background is transparent`
    );
    assert(
      dialog.select_background_color !== dialog.select_color,
      `${theme} select foreground and background are indistinguishable`
    );
    assert(
      dialog.option_background_color !== dialog.option_color,
      `${theme} option foreground and background are indistinguishable`
    );
    dialogThemes.push({ theme, ...dialog });
  }

  const baselineScale = await page.evaluate(() => ({
    topbar_height:
      document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0,
    submit_height:
      document
        .querySelector('.modal-card button[type="submit"]')
        ?.getBoundingClientRect().height ?? 0
  }));
  await page
    .locator('.modal-card input[type="range"]')
    .first()
    .evaluate((element) => {
      element.value = '150';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  const scalePreview = await page.evaluate(() => ({
    input_value:
      document.querySelector('.modal-card input[type="range"]')?.value ?? '',
    app_scale: getComputedStyle(
      document.querySelector('.app-shell') ?? document.body
    ).getPropertyValue('--ui-scale'),
    app_style:
      document.querySelector('.app-shell')?.getAttribute('style') ?? '',
    app_transform: getComputedStyle(
      document.querySelector('.app-shell') ?? document.body
    ).transform,
    dialog_transform: getComputedStyle(
      document.querySelector('.modal-backdrop') ?? document.body
    ).transform,
    topbar_height:
      document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0,
    submit_height:
      document
        .querySelector('.modal-card button[type="submit"]')
        ?.getBoundingClientRect().height ?? 0
  }));
  assert(
    scalePreview.app_transform.startsWith('matrix(1.5'),
    `150% preview did not configure the complete application viewport (${scalePreview.app_transform}; variable ${scalePreview.app_scale}; input ${scalePreview.input_value}; style ${scalePreview.app_style})`
  );
  assert(
    scalePreview.dialog_transform.startsWith('matrix(1,'),
    `150% preview resized the Settings dialog (${scalePreview.dialog_transform})`
  );
  assert(
    scalePreview.topbar_height >= baselineScale.topbar_height * 1.45,
    `150% preview did not scale the application chrome (${baselineScale.topbar_height} -> ${scalePreview.topbar_height})`
  );
  assert(
    Math.abs(scalePreview.submit_height - baselineScale.submit_height) < 1,
    `150% preview resized the Settings controls (${baselineScale.submit_height} -> ${scalePreview.submit_height})`
  );
  await page
    .locator('.modal-card input[type="range"]')
    .first()
    .evaluate((element) => {
      element.value = '200';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.locator('.modal-card').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.locator('.modal-card').waitFor();

  const highScaleDialog = await page.evaluate(() => {
    const backdrop = document.querySelector('.modal-backdrop');
    const card = document.querySelector('.modal-card');
    const content = document.querySelector('.settings-scroll');
    const header = document.querySelector('.settings-header');
    const footer = document.querySelector('.settings-footer');
    const save = document.querySelector(
      '.settings-footer button[type="submit"]'
    );
    const close = document.querySelector('.settings-header .icon-button');
    if (
      !(backdrop instanceof HTMLElement) ||
      !(card instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(footer instanceof HTMLElement) ||
      !(save instanceof HTMLElement) ||
      !(close instanceof HTMLElement)
    ) {
      throw new Error('high-scale Settings dialog is missing');
    }
    const backdropBounds = backdrop.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    const saveBounds = save.getBoundingClientRect();
    const closeBounds = close.getBoundingClientRect();
    return {
      backdrop_transform: getComputedStyle(backdrop).transform,
      backdrop_top: backdropBounds.top,
      backdrop_bottom: backdropBounds.bottom,
      card_top: cardBounds.top,
      card_bottom: cardBounds.bottom,
      content_top: contentBounds.top,
      content_bottom: contentBounds.bottom,
      content_client_height: content.clientHeight,
      content_scroll_height: content.scrollHeight,
      header_bottom: headerBounds.bottom,
      footer_top: footerBounds.top,
      save_top: saveBounds.top,
      save_bottom: saveBounds.bottom,
      close_top: closeBounds.top,
      close_bottom: closeBounds.bottom,
      viewport_height: window.innerHeight
    };
  });
  assert(
    highScaleDialog.backdrop_transform.startsWith('matrix(2,'),
    `reopened Settings dialog did not adopt 200% scale (${highScaleDialog.backdrop_transform})`
  );
  assert(
    highScaleDialog.card_top >= -1 &&
      highScaleDialog.card_bottom <= highScaleDialog.viewport_height + 1,
    `200% Settings dialog escaped the viewport (${highScaleDialog.card_top}..${highScaleDialog.card_bottom} of ${highScaleDialog.viewport_height})`
  );
  assert(
    highScaleDialog.content_scroll_height >
      highScaleDialog.content_client_height,
    '200% Settings content does not expose an internal scroll range'
  );
  assert(
    highScaleDialog.header_bottom <= highScaleDialog.content_top + 1 &&
      highScaleDialog.content_bottom <= highScaleDialog.footer_top + 1 &&
      highScaleDialog.save_top >= 0 &&
      highScaleDialog.save_bottom <= highScaleDialog.viewport_height &&
      highScaleDialog.close_top >= 0 &&
      highScaleDialog.close_bottom <= highScaleDialog.viewport_height,
    'Settings title, content, and primary actions are not simultaneously reachable at 200%'
  );
  await page.screenshot({ path: highScaleSettingsScreenshotPath });

  await page.getByRole('button', { name: 'Reset settings…' }).click();
  const highScaleReset = await page
    .locator('.settings-footer')
    .evaluate((element) => {
      const buttons = Array.from(element.querySelectorAll('button')).map(
        (button) => {
          const bounds = button.getBoundingClientRect();
          return {
            label: button.textContent?.trim() ?? '',
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom
          };
        }
      );
      return {
        client_width: element.clientWidth,
        scroll_width: element.scrollWidth,
        buttons
      };
    });
  assert(
    highScaleReset.scroll_width <= highScaleReset.client_width &&
      highScaleReset.buttons.every(
        (button) =>
          button.left >= 0 &&
          button.right <= 1280 &&
          button.top >= 0 &&
          button.bottom <= 600
      ),
    `reset confirmation escaped the 200% Settings footer (${JSON.stringify(highScaleReset)})`
  );
  await page
    .locator('.settings-reset')
    .getByRole('button', { name: 'Cancel' })
    .click();
  highScaleDialog.reset_confirmation = highScaleReset;

  const highScaleSave = page.getByRole('button', { name: 'Save settings' });
  await page
    .locator('.modal-card input[type="range"]')
    .first()
    .evaluate((element) => {
      element.value = '100';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await highScaleSave.click();
  await page.locator('.modal-card').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: widths[0], height: 1068 });
  await page.getByRole('button', { name: 'Settings' }).first().click();

  const connectionPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce'
  });
  await connectionPage.goto(`http://127.0.0.1:${address.port}`, {
    waitUntil: 'networkidle'
  });
  await connectionPage
    .getByRole('button', { name: 'Create connection' })
    .first()
    .click();
  await connectionPage.locator('.profile-dialog').waitFor();

  const connectionServer = await connectionPage
    .locator('.profile-dialog')
    .evaluate((element) => {
      const bounds = (selector) => {
        const target = element.querySelector(selector);
        if (!target) throw new Error(`connection ${selector} is missing`);
        return target.getBoundingClientRect().toJSON();
      };
      const clientIdentity = element.querySelector('.client-identity-details');
      return {
        headings: Array.from(
          element.querySelectorAll('.profile-section h3')
        ).map((heading) => heading.textContent?.trim() ?? ''),
        source_labels: Array.from(
          element.querySelectorAll('.connection-source-choice label strong')
        ).map((label) => label.textContent?.trim() ?? ''),
        card: element.getBoundingClientRect().toJSON(),
        header: bounds('.profile-header'),
        content: bounds('.profile-scroll'),
        footer: bounds('.profile-footer'),
        save: bounds('button[type="submit"]'),
        password_count: element.querySelectorAll('input[type="password"]')
          .length,
        client_identity_open:
          clientIdentity instanceof HTMLDetailsElement && clientIdentity.open,
        content_client_height:
          element.querySelector('.profile-scroll')?.clientHeight ?? 0,
        content_scroll_height:
          element.querySelector('.profile-scroll')?.scrollHeight ?? 0
      };
    });
  assert(
    JSON.stringify(connectionServer.headings) ===
      JSON.stringify([
        'Connection details',
        'Transport security',
        'Credentials',
        'Connection behavior'
      ]) &&
      JSON.stringify(connectionServer.source_labels) ===
        JSON.stringify(['Server', 'Database file']),
    `server connection hierarchy is incomplete (${JSON.stringify(connectionServer)})`
  );
  assert(
    connectionServer.password_count === 0 &&
      !connectionServer.client_identity_open,
    'optional connection credentials are expanded before the user requests them'
  );
  assert(
    connectionServer.header.bottom <= connectionServer.content.top + 1 &&
      connectionServer.content.bottom <= connectionServer.footer.top + 1 &&
      connectionServer.save.bottom <= connectionServer.card.bottom + 1,
    'server connection header, content, and persistent actions overlap'
  );
  await connectionPage.screenshot({ path: connectionServerScreenshotPath });

  await connectionPage.locator('input[value="vault"]').check();
  await connectionPage.locator('input[type="password"]').waitFor();
  await connectionPage.getByLabel('TLS mode').selectOption('disabled');
  const unsafeTlsWarning = await connectionPage
    .getByRole('alert')
    .textContent();
  assert(
    unsafeTlsWarning?.includes('without TLS'),
    'unencrypted connection mode lost its explicit warning'
  );
  await connectionPage.getByLabel('TLS mode').selectOption('custom_ca');
  await connectionPage.getByText('No CA selected', { exact: true }).waitFor();
  await connectionPage.locator('.client-identity-details summary').click();
  const connectionSecurity = await connectionPage.evaluate(() => {
    const dialog = document.querySelector('.profile-dialog');
    const details = document.querySelector('.client-identity-details');
    if (
      !(dialog instanceof HTMLElement) ||
      !(details instanceof HTMLDetailsElement)
    ) {
      throw new Error('advanced connection security state is missing');
    }
    return {
      client_identity_open: details.open,
      password_visible: Boolean(dialog.querySelector('input[type="password"]')),
      has_custom_ca: dialog.textContent?.includes('No CA selected') ?? false,
      scroll_width: dialog.scrollWidth,
      client_width: dialog.clientWidth
    };
  });
  assert(
    connectionSecurity.client_identity_open &&
      connectionSecurity.password_visible &&
      connectionSecurity.has_custom_ca &&
      connectionSecurity.scroll_width <= connectionSecurity.client_width,
    `advanced connection security is clipped or incomplete (${JSON.stringify(connectionSecurity)})`
  );
  await connectionPage.locator('.profile-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await connectionPage.screenshot({ path: connectionSecurityScreenshotPath });

  await connectionPage
    .locator('.connection-source-choice label')
    .nth(1)
    .click();
  const connectionFile = await connectionPage
    .locator('.profile-dialog')
    .evaluate((element) => ({
      headings: Array.from(element.querySelectorAll('.profile-section h3')).map(
        (heading) => heading.textContent?.trim() ?? ''
      ),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      card: element.getBoundingClientRect().toJSON(),
      save_disabled:
        element.querySelector('button[type="submit"]') instanceof
          HTMLButtonElement &&
        element.querySelector('button[type="submit"]').disabled,
      content_client_width:
        element.querySelector('.profile-scroll')?.clientWidth ?? 0,
      content_scroll_width:
        element.querySelector('.profile-scroll')?.scrollWidth ?? 0
    }));
  assert(
    JSON.stringify(connectionFile.headings) ===
      JSON.stringify(['Database file', 'Profile details']) &&
      !connectionFile.text.includes('Automatic reconnect') &&
      connectionFile.save_disabled,
    `file connection exposes irrelevant or unsafe controls (${JSON.stringify(connectionFile)})`
  );
  assert(
    connectionFile.card.height < connectionServer.card.height &&
      connectionFile.content_scroll_width <=
        connectionFile.content_client_width,
    'file connection keeps the tall server-dialog footprint or overflows'
  );
  await connectionPage.screenshot({ path: connectionFileScreenshotPath });

  await connectionPage.setViewportSize({ width: 720, height: 700 });
  const compactConnectionFile = await connectionPage.evaluate(() => {
    const card = document.querySelector('.profile-dialog');
    const content = document.querySelector('.profile-scroll');
    const footer = document.querySelector('.profile-footer');
    if (
      !(card instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      !(footer instanceof HTMLElement)
    ) {
      throw new Error('compact file connection is missing');
    }
    return {
      viewport_width: window.innerWidth,
      document_scroll_width: document.documentElement.scrollWidth,
      card: card.getBoundingClientRect().toJSON(),
      content_client_width: content.clientWidth,
      content_scroll_width: content.scrollWidth,
      footer: footer.getBoundingClientRect().toJSON()
    };
  });
  assert(
    compactConnectionFile.document_scroll_width <=
      compactConnectionFile.viewport_width &&
      compactConnectionFile.content_scroll_width <=
        compactConnectionFile.content_client_width &&
      compactConnectionFile.card.left >= -1 &&
      compactConnectionFile.card.right <=
        compactConnectionFile.viewport_width + 1 &&
      compactConnectionFile.footer.bottom <= 700,
    `720px file connection escaped its viewport (${JSON.stringify(compactConnectionFile)})`
  );

  await connectionPage.getByRole('button', { name: 'Close' }).click();
  await connectionPage.setViewportSize({ width: widths[0], height: 1068 });
  await connectionPage
    .getByRole('button', { name: 'Settings' })
    .first()
    .click();
  await connectionPage
    .locator('.modal-card input[type="range"]')
    .first()
    .evaluate((element) => {
      element.value = '200';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await connectionPage.getByRole('button', { name: 'Save settings' }).click();
  await connectionPage.setViewportSize({ width: 1280, height: 600 });
  await connectionPage
    .locator('button[aria-label="Create connection profile"]')
    .click();
  await connectionPage.locator('.profile-dialog').waitFor();
  const highScaleConnection = await connectionPage.evaluate(() => {
    const backdrop = document.querySelector('.modal-backdrop');
    const card = document.querySelector('.profile-dialog');
    const content = document.querySelector('.profile-scroll');
    const header = document.querySelector('.profile-header');
    const footer = document.querySelector('.profile-footer');
    const save = document.querySelector(
      '.profile-footer button[type="submit"]'
    );
    const close = document.querySelector('.profile-header .icon-button');
    if (
      !(backdrop instanceof HTMLElement) ||
      !(card instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(footer instanceof HTMLElement) ||
      !(save instanceof HTMLElement) ||
      !(close instanceof HTMLElement)
    ) {
      throw new Error('high-scale connection dialog is incomplete');
    }
    const cardBounds = card.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    const saveBounds = save.getBoundingClientRect();
    const closeBounds = close.getBoundingClientRect();
    return {
      backdrop_transform: getComputedStyle(backdrop).transform,
      card: cardBounds.toJSON(),
      content_top: contentBounds.top,
      content_bottom: contentBounds.bottom,
      content_client_height: content.clientHeight,
      content_scroll_height: content.scrollHeight,
      header_bottom: headerBounds.bottom,
      footer_top: footerBounds.top,
      save: saveBounds.toJSON(),
      close: closeBounds.toJSON(),
      viewport_height: window.innerHeight
    };
  });
  assert(
    highScaleConnection.backdrop_transform.startsWith('matrix(2,') &&
      highScaleConnection.card.top >= -1 &&
      highScaleConnection.card.bottom <=
        highScaleConnection.viewport_height + 1 &&
      highScaleConnection.content_scroll_height >
        highScaleConnection.content_client_height &&
      highScaleConnection.header_bottom <=
        highScaleConnection.content_top + 1 &&
      highScaleConnection.content_bottom <=
        highScaleConnection.footer_top + 1 &&
      highScaleConnection.save.top >= 0 &&
      highScaleConnection.save.bottom <= highScaleConnection.viewport_height &&
      highScaleConnection.close.top >= 0 &&
      highScaleConnection.close.bottom <= highScaleConnection.viewport_height,
    `200% connection dialog is not fully reachable (${JSON.stringify(highScaleConnection)})`
  );
  await connectionPage.screenshot({ path: highScaleConnectionScreenshotPath });
  await connectionPage.close();
  const connectionDialog = {
    server: connectionServer,
    security: connectionSecurity,
    file: connectionFile,
    compact_file: compactConnectionFile,
    reopened_200_percent: highScaleConnection
  };

  const editorPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce'
  });
  await editorPage.goto(
    `http://127.0.0.1:${address.port}/scripts/fixtures/editor-focus.html`,
    { waitUntil: 'networkidle' }
  );
  const editor = editorPage.locator('.cm-editor');
  const content = editorPage.locator('.cm-content');
  await editor.waitFor();
  await editor.evaluate((element) => {
    element.setAttribute('data-focus-regression-node', 'stable');
  });
  await content.click();
  await content.pressSequentially('select 12345;', { delay: 45 });
  await editorPage.waitForTimeout(1_150);
  const editorFocus = await editorPage.evaluate(() => {
    const currentEditor = document.querySelector('.cm-editor');
    const currentContent = document.querySelector('.cm-content');
    return {
      same_node:
        currentEditor?.getAttribute('data-focus-regression-node') === 'stable',
      focused:
        currentContent === document.activeElement ||
        currentContent?.contains(document.activeElement),
      text: currentContent?.textContent ?? '',
      recovery_banner:
        document.querySelector('.recovery-banner')?.textContent ?? null
    };
  });
  assert(editorFocus.same_node, 'typing remounted the CodeMirror editor node');
  assert(editorFocus.focused, 'typing moved focus away from the SQL editor');
  assert(
    editorFocus.text === 'select 12345;',
    `typing lost SQL characters (${JSON.stringify(editorFocus.text)})`
  );
  assert(
    editorFocus.recovery_banner === null,
    `normal typing displayed a recovery banner (${editorFocus.recovery_banner})`
  );

  await content.click();
  await content.press('Control+a');
  await content.press('Backspace');
  await content.pressSequentially('sel', { delay: 45 });
  const completion = editorPage.locator('.cm-tooltip-autocomplete');
  await completion.waitFor();
  await editorPage.waitForTimeout(100);
  const completionTheme = await completion.evaluate((element) => {
    const selected = element.querySelector('[aria-selected="true"]');
    if (!selected) throw new Error('completion has no selected option');
    const popupStyle = getComputedStyle(element);
    const selectedStyle = getComputedStyle(selected);
    return {
      popup_background: popupStyle.backgroundColor,
      popup_color: popupStyle.color,
      selected_background: selectedStyle.backgroundColor,
      selected_color: selectedStyle.color
    };
  });
  assert(
    completionTheme.popup_background !== completionTheme.popup_color,
    'dark completion popup foreground and background are indistinguishable'
  );
  assert(
    completionTheme.selected_background !== completionTheme.selected_color,
    'dark selected completion foreground and background are indistinguishable'
  );
  await editorPage.screenshot({ path: autocompleteScreenshotPath });

  await content.press('Enter');
  await completion.waitFor({ state: 'detached' });
  const enterBehavior = await editorPage.evaluate(() => ({
    lines: Array.from(document.querySelectorAll('.cm-line')).map(
      (element) => element.textContent ?? ''
    ),
    focused: document.querySelector('.cm-content') === document.activeElement
  }));
  assert(
    enterBehavior.lines.length === 2 && enterBehavior.lines[0] === 'sel',
    `Enter accepted a completion instead of inserting a line (${JSON.stringify(enterBehavior.lines)})`
  );
  assert(enterBehavior.focused, 'Enter moved focus out of the SQL editor');

  await content.press('Control+a');
  await content.press('Backspace');
  await content.pressSequentially('sel', { delay: 45 });
  await completion.waitFor();
  await editorPage.waitForTimeout(100);
  await content.press('Tab');
  await completion.waitFor({ state: 'detached' });
  const tabBehavior = await editorPage.evaluate(() => ({
    text: document.querySelector('.cm-content')?.textContent ?? '',
    focused: document.querySelector('.cm-content') === document.activeElement
  }));
  assert(
    tabBehavior.text.toLocaleLowerCase() === 'select',
    `Tab did not accept the selected SQL completion (${JSON.stringify(tabBehavior.text)})`
  );
  assert(tabBehavior.focused, 'Tab moved focus out of the SQL editor');
  editorFocus.completion_theme = completionTheme;
  editorFocus.enter_completion_behavior = enterBehavior;
  editorFocus.tab_completion_behavior = tabBehavior;
  await editorPage.close();

  const workbenchPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce'
  });
  await workbenchPage.goto(
    `http://127.0.0.1:${address.port}/scripts/fixtures/workbench-layout.html`,
    { waitUntil: 'networkidle' }
  );
  const emissaryRow = workbenchPage.locator('[data-profile-id="emissary"]');
  await emissaryRow.waitFor();
  const connectionMenuTrigger = workbenchPage.getByRole('button', {
    name: 'More actions for Emissary',
    exact: true
  });
  await connectionMenuTrigger.click();
  const connectionMenu = workbenchPage.getByRole('menu', {
    name: 'Actions for Emissary',
    exact: true
  });
  await connectionMenu.waitFor();
  const connectionActionMenu = await workbenchPage.evaluate(() => {
    const aside = document.querySelector('aside');
    const popover = document.querySelector(
      '.connection-profile-menu .action-menu-popover'
    );
    const menu = document.querySelector(
      '.connection-profile-menu [role="menu"]'
    );
    if (!aside || !popover || !menu) {
      throw new Error('saved-connection action menu is incomplete');
    }
    const bounds = popover.getBoundingClientRect();
    const asideBounds = aside.getBoundingClientRect();
    return {
      labels: Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
        (item) => item.querySelector('strong')?.textContent?.trim() ?? ''
      ),
      focused:
        document.activeElement?.querySelector('strong')?.textContent?.trim() ??
        '',
      bounds: bounds.toJSON(),
      aside: asideBounds.toJSON(),
      danger_count: menu.querySelectorAll('[role="menuitem"].danger').length,
      document_scroll_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth
    };
  });
  assert(
    JSON.stringify(connectionActionMenu.labels) ===
      JSON.stringify([
        'Test connection',
        'Edit connection…',
        'Duplicate connection',
        'Delete connection…'
      ]),
    `saved-connection actions are incomplete (${JSON.stringify(connectionActionMenu.labels)})`
  );
  assert(
    connectionActionMenu.focused === 'Test connection',
    `saved-connection menu did not focus its first action (${connectionActionMenu.focused})`
  );
  assert(
    connectionActionMenu.danger_count === 1,
    'saved-connection menu does not distinguish its destructive action'
  );
  assert(
    connectionActionMenu.bounds.left >= connectionActionMenu.aside.left - 1 &&
      connectionActionMenu.bounds.right <=
        connectionActionMenu.aside.right + 1 &&
      connectionActionMenu.bounds.top >= connectionActionMenu.aside.top - 1 &&
      connectionActionMenu.bounds.bottom <=
        connectionActionMenu.aside.bottom + 1 &&
      connectionActionMenu.document_scroll_width <=
        connectionActionMenu.viewport_width,
    `saved-connection menu escaped or was clipped by the sidebar (${JSON.stringify(connectionActionMenu)})`
  );
  await workbenchPage.keyboard.press('ArrowDown');
  const secondConnectionAction = await workbenchPage.evaluate(
    () =>
      document.activeElement?.querySelector('strong')?.textContent?.trim() ?? ''
  );
  assert(
    secondConnectionAction === 'Edit connection…',
    `ArrowDown did not move through saved-connection actions (${secondConnectionAction})`
  );
  await workbenchPage.screenshot({ path: connectionMenuScreenshotPath });
  await workbenchPage.keyboard.press('Escape');
  await connectionMenu.waitFor({ state: 'detached' });
  assert(
    await connectionMenuTrigger.evaluate(
      (element) => element === document.activeElement
    ),
    'Escape did not return focus to the saved-connection menu trigger'
  );
  await connectionMenuTrigger.click();
  await connectionMenu.waitFor();
  await workbenchPage.locator('#query-editor-pane').click({
    position: { x: 16, y: 16 }
  });
  await connectionMenu.waitFor({ state: 'detached' });
  const initialWorkbenchAlignment = await workbenchPage.evaluate(() => {
    const editor = document.querySelector('#query-editor-pane');
    const documentActions = document.querySelector('.toolbar-document');
    const tabs = document.querySelector('.workspace-tabs');
    const newTab = document.querySelector('.new-tab');
    const connectionAdd = document.querySelector(
      'button[aria-label="Create connection profile"]'
    );
    const connectionAddIcon = connectionAdd?.querySelector('svg');
    if (
      !editor ||
      !documentActions ||
      !tabs ||
      !newTab ||
      !connectionAdd ||
      !connectionAddIcon
    ) {
      throw new Error('initial workbench alignment controls are missing');
    }
    const editorBounds = editor.getBoundingClientRect();
    const documentBounds = documentActions.getBoundingClientRect();
    const tabsBounds = tabs.getBoundingClientRect();
    const newTabBounds = newTab.getBoundingClientRect();
    const addBounds = connectionAdd.getBoundingClientRect();
    const addIconBounds = connectionAddIcon.getBoundingClientRect();
    return {
      document_action_offset: documentBounds.left - editorBounds.left,
      new_tab_gap: newTabBounds.left - tabsBounds.right,
      connection_add_icon_offset: {
        x:
          addIconBounds.left +
          addIconBounds.width / 2 -
          (addBounds.left + addBounds.width / 2),
        y:
          addIconBounds.top +
          addIconBounds.height / 2 -
          (addBounds.top + addBounds.height / 2)
      },
      tab_widths: Array.from(
        document.querySelectorAll('.workspace-tab-item')
      ).map((element) => element.getBoundingClientRect().width),
      unsaved_text_count: Array.from(
        document.querySelectorAll('.workspace-tab-item')
      ).filter((element) => element.textContent?.includes('Unsaved')).length,
      edited_icon_count: document.querySelectorAll(
        '.workspace-tab-item [aria-label="Unsaved changes"]'
      ).length
    };
  });
  assert(
    Math.abs(initialWorkbenchAlignment.connection_add_icon_offset.x) <= 0.5 &&
      Math.abs(initialWorkbenchAlignment.connection_add_icon_offset.y) <= 0.5,
    `connection Plus SVG is not centered in its button (${JSON.stringify(initialWorkbenchAlignment.connection_add_icon_offset)})`
  );
  assert(
    initialWorkbenchAlignment.document_action_offset <= 24,
    `offline document actions are stranded away from the editor (${initialWorkbenchAlignment.document_action_offset}px)`
  );
  assert(
    initialWorkbenchAlignment.new_tab_gap >= 0 &&
      initialWorkbenchAlignment.new_tab_gap <= 8,
    `new-tab action is not adjacent to the visible tabs (${initialWorkbenchAlignment.new_tab_gap}px)`
  );
  assert(
    initialWorkbenchAlignment.tab_widths.every((width) => width <= 150),
    `workspace tabs are still stretched (${JSON.stringify(initialWorkbenchAlignment.tab_widths)})`
  );
  assert(
    initialWorkbenchAlignment.unsaved_text_count === 0 &&
      initialWorkbenchAlignment.edited_icon_count === 2,
    'dirty tabs do not use compact labelled edit icons'
  );
  await workbenchPage.setViewportSize({ width: 1915, height: 1237 });
  const largeScaleAlignment = await workbenchPage.evaluate(async () => {
    const shell = document.querySelector('.app-shell');
    if (!(shell instanceof HTMLElement)) {
      throw new Error('large-scale workbench shell is missing');
    }
    shell.style.setProperty('--ui-scale', '1.5');
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const tabs = document
      .querySelector('.workspace-tabs')
      ?.getBoundingClientRect();
    const newTab = document.querySelector('.new-tab')?.getBoundingClientRect();
    const footer = document.querySelector('footer')?.getBoundingClientRect();
    const connectionAdd = document
      .querySelector('button[aria-label="Create connection profile"]')
      ?.getBoundingClientRect();
    const connectionAddIcon = document
      .querySelector('button[aria-label="Create connection profile"] svg')
      ?.getBoundingClientRect();
    if (!tabs || !newTab || !footer || !connectionAdd || !connectionAddIcon) {
      throw new Error('large-scale workbench controls are incomplete');
    }
    return {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      document_scroll_width: document.documentElement.scrollWidth,
      document_scroll_height: document.documentElement.scrollHeight,
      connection_add_icon_offset: {
        x:
          connectionAddIcon.left +
          connectionAddIcon.width / 2 -
          (connectionAdd.left + connectionAdd.width / 2),
        y:
          connectionAddIcon.top +
          connectionAddIcon.height / 2 -
          (connectionAdd.top + connectionAdd.height / 2)
      },
      new_tab_gap: newTab.left - tabs.right,
      tab_widths: Array.from(
        document.querySelectorAll('.workspace-tab-item')
      ).map((element) => element.getBoundingClientRect().width),
      footer_bottom: footer.bottom,
      transform: getComputedStyle(shell).transform
    };
  });
  assert(
    largeScaleAlignment.document_scroll_width <=
      largeScaleAlignment.viewport_width &&
      largeScaleAlignment.document_scroll_height <=
        largeScaleAlignment.viewport_height,
    '150% large workbench has page-level overflow'
  );
  assert(
    largeScaleAlignment.new_tab_gap >= 0 &&
      largeScaleAlignment.new_tab_gap <= 12,
    `150% new-tab action is separated from its tabs (${largeScaleAlignment.new_tab_gap}px)`
  );
  assert(
    Math.abs(largeScaleAlignment.connection_add_icon_offset.x) <= 0.75 &&
      Math.abs(largeScaleAlignment.connection_add_icon_offset.y) <= 0.75,
    `150% connection Plus SVG is not centered in its button (${JSON.stringify(largeScaleAlignment.connection_add_icon_offset)})`
  );
  assert(
    largeScaleAlignment.tab_widths.every((width) => width <= 230),
    `150% workspace tabs are still stretched (${JSON.stringify(largeScaleAlignment.tab_widths)})`
  );
  assert(
    largeScaleAlignment.footer_bottom <= largeScaleAlignment.viewport_height,
    '150% large workbench footer escaped the viewport'
  );
  await connectionMenuTrigger.click();
  await connectionMenu.waitFor();
  const largeScaleConnectionMenu = await workbenchPage.evaluate(() => {
    const aside = document.querySelector('aside');
    const popover = document.querySelector(
      '.connection-profile-menu .action-menu-popover'
    );
    if (!aside || !popover) {
      throw new Error('150% saved-connection menu is missing');
    }
    return {
      bounds: popover.getBoundingClientRect().toJSON(),
      aside: aside.getBoundingClientRect().toJSON(),
      document_scroll_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth
    };
  });
  assert(
    largeScaleConnectionMenu.bounds.left >=
      largeScaleConnectionMenu.aside.left - 1 &&
      largeScaleConnectionMenu.bounds.right <=
        largeScaleConnectionMenu.aside.right + 1 &&
      largeScaleConnectionMenu.bounds.top >=
        largeScaleConnectionMenu.aside.top - 1 &&
      largeScaleConnectionMenu.bounds.bottom <=
        largeScaleConnectionMenu.aside.bottom + 1 &&
      largeScaleConnectionMenu.document_scroll_width <=
        largeScaleConnectionMenu.viewport_width,
    `150% saved-connection menu escaped or was clipped by the sidebar (${JSON.stringify(largeScaleConnectionMenu)})`
  );
  await workbenchPage.keyboard.press('Escape');
  await connectionMenu.waitFor({ state: 'detached' });
  largeScaleAlignment.connection_action_menu = largeScaleConnectionMenu;
  await workbenchPage.screenshot({
    path: largeScaleWorkbenchScreenshotPath,
    fullPage: true
  });
  await workbenchPage.evaluate(() => {
    document.querySelector('.app-shell')?.style.setProperty('--ui-scale', '1');
  });
  await workbenchPage.setViewportSize({ width: 1280, height: 800 });
  initialWorkbenchAlignment.large_scale_150_percent = largeScaleAlignment;
  await emissaryRow.locator('.connection-action').click();
  await workbenchPage
    .getByRole('button', { name: 'Disconnect', exact: true })
    .waitFor();
  const sidebarSeparator = workbenchPage.locator('.sidebar-separator');
  await sidebarSeparator.waitFor();
  const measureSidebarSplit = () =>
    workbenchPage.evaluate(() => {
      const connections = document
        .querySelector('.connections-pane')
        ?.getBoundingClientRect();
      const schema = document
        .querySelector('.schema-explorer')
        ?.getBoundingClientRect();
      const separator = document.querySelector('.sidebar-separator');
      if (!connections || !schema || !separator) {
        throw new Error('sidebar split geometry is incomplete');
      }
      return {
        connections_height: connections.height,
        schema_height: schema.height,
        aria_value: separator.getAttribute('aria-valuenow'),
        connection_rows: Array.from(
          document.querySelectorAll('.connection-row')
        ).map((row) => row.getBoundingClientRect().toJSON())
      };
    });
  const sidebarSplit50 = await measureSidebarSplit();
  assert(
    sidebarSplit50.aria_value === '50' &&
      Math.abs(
        sidebarSplit50.connections_height - sidebarSplit50.schema_height
      ) <= 2,
    `sidebar did not start at its centered split (${JSON.stringify(sidebarSplit50)})`
  );
  assert(
    sidebarSplit50.connection_rows.every(
      (row, index, rows) =>
        index === 0 || row.top - rows[index - 1].bottom <= 10
    ),
    `connection rows are not compact (${JSON.stringify(sidebarSplit50.connection_rows)})`
  );
  assert(
    (await workbenchPage.locator('.schema-filter').count()) === 0 &&
      !(await workbenchPage.locator('aside').innerText()).includes(
        'Metadata is current.'
      ),
    'schema search or routine metadata description consumes default space'
  );
  await workbenchPage
    .getByRole('button', { name: 'Search schema objects' })
    .click();
  await workbenchPage.locator('.schema-filter input').waitFor();
  await workbenchPage
    .getByRole('button', { name: 'Close schema search' })
    .click();
  assert(
    (await workbenchPage.locator('.schema-filter').count()) === 0,
    'schema search did not collapse back under its icon'
  );
  const sidebarSeparatorBounds = await sidebarSeparator.boundingBox();
  if (!sidebarSeparatorBounds) {
    throw new Error('sidebar separator has no pointer target');
  }
  await workbenchPage.mouse.move(
    sidebarSeparatorBounds.x + sidebarSeparatorBounds.width / 2,
    sidebarSeparatorBounds.y + sidebarSeparatorBounds.height / 2
  );
  await workbenchPage.mouse.down();
  await workbenchPage.mouse.move(
    sidebarSeparatorBounds.x + sidebarSeparatorBounds.width / 2,
    sidebarSeparatorBounds.y + sidebarSeparatorBounds.height / 2 + 60
  );
  await workbenchPage.mouse.up();
  const sidebarPointerSplit = await measureSidebarSplit();
  assert(
    Number(sidebarPointerSplit.aria_value) > 50 &&
      sidebarPointerSplit.connections_height >
        sidebarSplit50.connections_height,
    `sidebar pointer drag did not resize the panes (${JSON.stringify(sidebarPointerSplit)})`
  );
  await sidebarSeparator.dblclick();
  await sidebarSeparator.focus();
  await sidebarSeparator.press('End');
  const sidebarSplit80 = await measureSidebarSplit();
  await sidebarSeparator.press('Home');
  const sidebarSplit20 = await measureSidebarSplit();
  await sidebarSeparator.dblclick();
  const sidebarSplitReset = await measureSidebarSplit();
  assert(
    sidebarSplit20.connections_height < sidebarSplitReset.connections_height &&
      sidebarSplitReset.connections_height <
        sidebarSplit80.connections_height &&
      sidebarSplitReset.aria_value === '50',
    `sidebar split keyboard bounds are not ordered (${JSON.stringify({ sidebarSplit20, sidebarSplitReset, sidebarSplit80 })})`
  );
  const schemaNamespaceLayout = await workbenchPage.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('.schema-tree > div > button:first-child')
    ).map((element) => element.getBoundingClientRect().toJSON());
    const tree = document.querySelector('.schema-tree');
    if (!(tree instanceof HTMLElement) || rows.length !== 2) {
      throw new Error('schema namespace fixture is incomplete');
    }
    return {
      rows,
      align_content: getComputedStyle(tree).alignContent,
      tree_height: tree.getBoundingClientRect().height
    };
  });
  assert(
    schemaNamespaceLayout.align_content === 'start' &&
      schemaNamespaceLayout.rows[1].top -
        schemaNamespaceLayout.rows[0].bottom <=
        12,
    `schema namespaces stretch down the sidebar (${JSON.stringify(schemaNamespaceLayout)})`
  );

  await workbenchPage
    .locator('.schema-tree > div > button:first-child')
    .first()
    .click();
  const inspectFractions = workbenchPage.getByRole('button', {
    name: 'Inspect structure for fractions',
    exact: true
  });
  await inspectFractions.waitFor();
  const schemaObjectMenuTrigger = workbenchPage.getByRole('button', {
    name: 'More actions for fractions',
    exact: true
  });
  await schemaObjectMenuTrigger.click();
  const schemaObjectMenu = workbenchPage.getByRole('menu', {
    name: 'Actions for fractions',
    exact: true
  });
  await schemaObjectMenu.waitFor();
  const schemaActionLabels = await schemaObjectMenu
    .getByRole('menuitem')
    .allTextContents();
  assert(
    schemaActionLabels
      .map((label) => label.replace(/\s+/g, ' ').trim())
      .join('|') ===
      'Copy qualified name main.fractions|Start new query Open a query in this connection.',
    `schema-object actions are incomplete (${JSON.stringify(schemaActionLabels)})`
  );
  await workbenchPage.screenshot({ path: schemaMenuScreenshotPath });
  await workbenchPage.keyboard.press('Escape');
  await schemaObjectMenu.waitFor({ state: 'detached' });
  const sessionsBeforeStructure = await workbenchPage.evaluate(
    () =>
      window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
        (entry) => entry.command === 'open_tab_session'
      ).length
  );
  await inspectFractions.click();
  await workbenchPage.locator('#columns-heading').waitFor();
  const schemaStructure = await workbenchPage.evaluate(() => {
    const detail = document.querySelector('.object-workspace');
    if (!detail) throw new Error('schema structure detail is missing');
    const text = detail.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      text,
      headings: Array.from(detail.querySelectorAll('.structure-panel h3')).map(
        (heading) => heading.textContent?.trim() ?? ''
      ),
      browse_rows: Boolean(
        Array.from(detail.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === 'Browse rows'
        )
      ),
      active_tab:
        document
          .querySelector('.workspace-tab-item.active .tab-title')
          ?.textContent?.trim() ?? '',
      sidebar_detail_count: document.querySelectorAll(
        'aside .object-workspace, aside .object-detail'
      ).length,
      data_button_count: Array.from(document.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Data'
      ).length,
      sessions_after_structure: window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
        (entry) => entry.command === 'open_tab_session'
      ).length,
      browse_calls: window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
        (entry) => entry.command === 'browse_table'
      ).length
    };
  });
  assert(
    JSON.stringify(schemaStructure.headings) ===
      JSON.stringify(['Columns', 'Indexes', 'Foreign keys']),
    `schema detail headings are incomplete (${JSON.stringify(schemaStructure.headings)})`
  );
  assert(
    schemaStructure.text.includes('INTEGER') &&
      schemaStructure.text.includes('Primary 1') &&
      schemaStructure.text.includes('fractions_name_idx') &&
      schemaStructure.text.includes('armors.id'),
    `schema detail omitted structural metadata (${schemaStructure.text})`
  );
  assert(
    schemaStructure.browse_rows,
    'selected object tab has no secondary Browse rows action'
  );
  assert(
    schemaStructure.active_tab === 'fractions' &&
      schemaStructure.sidebar_detail_count === 0,
    'structure did not open in its own main-workspace tab'
  );
  assert(
    schemaStructure.sessions_after_structure === sessionsBeforeStructure &&
      schemaStructure.browse_calls === 0,
    'opening structure allocated a table session or fetched rows implicitly'
  );
  assert(
    schemaStructure.data_button_count === 0,
    'ambiguous Data action remains in the schema tree'
  );
  await workbenchPage.setViewportSize({ width: 1915, height: 1237 });
  const schemaScale150 = await workbenchPage.evaluate(async () => {
    const shell = document.querySelector('.app-shell');
    const workspace = document.querySelector('.object-workspace');
    if (!(shell instanceof HTMLElement) || !workspace) {
      throw new Error('scaled schema workspace is missing');
    }
    shell.style.setProperty('--ui-scale', '1.5');
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const workspaceBounds = workspace.getBoundingClientRect();
    const footerBounds = document
      .querySelector('footer')
      ?.getBoundingClientRect();
    if (!footerBounds) throw new Error('scaled schema footer is missing');
    return {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      document_scroll_width: document.documentElement.scrollWidth,
      document_scroll_height: document.documentElement.scrollHeight,
      workspace: workspaceBounds.toJSON(),
      footer: footerBounds.toJSON()
    };
  });
  assert(
    schemaScale150.document_scroll_width <= schemaScale150.viewport_width &&
      schemaScale150.document_scroll_height <= schemaScale150.viewport_height,
    '150% schema workspace has page-level overflow'
  );
  assert(
    schemaScale150.workspace.bottom <= schemaScale150.footer.top,
    '150% schema workspace overlaps the status bar'
  );
  await workbenchPage.screenshot({
    path: schemaStructureScreenshotPath,
    fullPage: true
  });
  await workbenchPage.evaluate(() => {
    document.querySelector('.app-shell')?.style.setProperty('--ui-scale', '1');
  });
  await workbenchPage.setViewportSize({ width: 1280, height: 800 });
  schemaStructure.scale_150_percent = schemaScale150;

  await workbenchPage.getByRole('button', { name: 'Browse rows' }).click();
  await workbenchPage.locator('#table-data-heading').waitFor();
  const rowBrowserActivation = await workbenchPage.evaluate(() => ({
    sessions: window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
      (entry) => entry.command === 'open_tab_session'
    ).length,
    browse_calls: window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
      (entry) => entry.command === 'browse_table'
    ).length,
    heading:
      document.querySelector('#table-data-heading')?.textContent?.trim() ?? ''
  }));
  assert(
    rowBrowserActivation.sessions === sessionsBeforeStructure + 1 &&
      rowBrowserActivation.browse_calls === 1,
    `Browse rows did not lazily allocate exactly one table session and fetch (${JSON.stringify(rowBrowserActivation)})`
  );
  await workbenchPage
    .getByRole('button', { name: 'Structure', exact: true })
    .click();
  await workbenchPage.locator('#columns-heading').waitFor();
  schemaStructure.row_browser_activation = rowBrowserActivation;

  await workbenchPage.getByRole('tab', { name: /fractions query/i }).click();
  await workbenchPage.locator('.cm-content').click();
  await workbenchPage.locator('.cm-content').press('Control+Enter');
  await workbenchPage.locator('.grid-row').waitFor();

  const populatedWorkbench = await workbenchPage.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing populated workbench ${selector}`);
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height
      };
    };
    const emissaryName = document.querySelector(
      '[data-profile-id="emissary"] .connection-copy strong'
    );
    const emissaryAction = document.querySelector(
      '[data-profile-id="emissary"] .connection-action'
    );
    const visibleTabs = Array.from(
      document.querySelectorAll('[role="tab"] .tab-title')
    ).map((element) => element.textContent?.trim() ?? '');
    const resultColumnWidths = Object.fromEntries(
      Array.from(
        document.querySelectorAll('.grid-header > [role="columnheader"]')
      )
        .map((element) => {
          const name = element.querySelector('button')?.textContent?.trim();
          return name ? [name, element.getBoundingClientRect().width] : null;
        })
        .filter(Boolean)
    );
    const firstGridCell = document.querySelector('.grid-row [role="gridcell"]');
    const firstGridCellStyle = firstGridCell
      ? getComputedStyle(firstGridCell)
      : null;
    const controlMetrics = (selectors) =>
      Array.from(document.querySelectorAll(selectors)).map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          label: element.textContent?.trim().replace(/\s+/g, ' ') ?? '',
          height: bounds.height,
          left: bounds.left,
          right: bounds.right,
          background: style.backgroundColor,
          color: style.color,
          border: style.borderTopColor
        };
      });
    return {
      document_scroll_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth,
      aside_client_width: document.querySelector('aside')?.clientWidth ?? 0,
      aside_scroll_width: document.querySelector('aside')?.scrollWidth ?? 0,
      emissary_name_fits:
        Boolean(emissaryName) &&
        emissaryName.scrollWidth <= emissaryName.clientWidth,
      emissary_action_fits:
        Boolean(emissaryAction) &&
        emissaryAction.scrollWidth <= emissaryAction.clientWidth,
      emissary_state:
        document
          .querySelector('[data-profile-id="emissary"] .connection-state')
          ?.textContent?.trim() ?? '',
      sidebar_header_controls: controlMetrics(
        'aside .pane-heading .icon-button'
      ),
      schema_row_actions: Array.from(
        document.querySelectorAll('.schema-tree .schema-row-action')
      ).map((element) => ({
        label: element.getAttribute('aria-label') ?? '',
        text: element.textContent?.trim() ?? '',
        opacity: getComputedStyle(element).opacity,
        has_svg: Boolean(element.querySelector('svg'))
      })),
      schema_object_menus: Array.from(
        document.querySelectorAll(
          '.schema-tree .schema-object-menu .action-menu-trigger'
        )
      ).map((element) => ({
        label: element.getAttribute('aria-label') ?? '',
        text: element.textContent?.trim() ?? '',
        opacity: getComputedStyle(
          element.closest('.schema-object-menu') ?? element
        ).opacity,
        has_svg: Boolean(element.querySelector('svg'))
      })),
      visible_tabs: visibleTabs,
      result_column_widths: resultColumnWidths,
      table_font_size: firstGridCellStyle?.fontSize ?? '',
      table_font_family: firstGridCellStyle?.fontFamily ?? '',
      topbar: rect('.topbar'),
      topbar_background: getComputedStyle(
        document.querySelector('.topbar') ?? document.body
      ).backgroundColor,
      brand: rect('.brand'),
      connection_summary: rect('.connection-summary'),
      connection_summary_background: getComputedStyle(
        document.querySelector('.connection-summary') ?? document.body
      ).backgroundColor,
      header_controls: controlMetrics('.topbar-control'),
      toolbar_group_count: document.querySelectorAll(
        '.query-toolbar > .toolbar-group'
      ).length,
      execution_controls: controlMetrics(
        '.toolbar-execution > button, .toolbar-execution > label > select'
      ),
      execution_group: rect('.toolbar-execution'),
      document_group: rect('.toolbar-document'),
      result_actions: controlMetrics(
        '.result-actions > button, .result-actions > details > summary'
      ),
      result_context:
        document.querySelector('.results-context')?.textContent?.trim() ?? '',
      loaded_label:
        document.querySelector('.loaded-label')?.textContent?.trim() ?? '',
      footer_shortcuts:
        document
          .querySelector('footer > span:last-child')
          ?.textContent?.trim() ?? '',
      editor: rect('#query-editor-pane'),
      separator: rect('.results-separator'),
      results: rect('#query-results'),
      results_heading: rect('#results-heading'),
      grid_header: rect('.grid-header'),
      grid_viewport: rect('.grid-viewport'),
      first_row: rect('.grid-row'),
      footer: rect('footer')
    };
  });
  assert(
    populatedWorkbench.document_scroll_width <=
      populatedWorkbench.viewport_width,
    'populated workbench has page-level horizontal overflow'
  );
  assert(
    populatedWorkbench.aside_scroll_width <=
      populatedWorkbench.aside_client_width,
    'current connection list overflows the sidebar'
  );
  assert(
    populatedWorkbench.emissary_name_fits,
    'ordinary connection name is clipped'
  );
  assert(
    populatedWorkbench.emissary_action_fits,
    'connection action text is clipped'
  );
  assert(
    populatedWorkbench.emissary_state === 'Connected',
    `connection state is not explicit (${populatedWorkbench.emissary_state})`
  );
  assert(
    populatedWorkbench.sidebar_header_controls.length === 3 &&
      Math.max(
        ...populatedWorkbench.sidebar_header_controls.map(
          (control) => control.height
        )
      ) -
        Math.min(
          ...populatedWorkbench.sidebar_header_controls.map(
            (control) => control.height
          )
        ) <=
        1,
    `sidebar header controls do not share one compact tier (${JSON.stringify(populatedWorkbench.sidebar_header_controls)})`
  );
  assert(
    populatedWorkbench.schema_row_actions.length === 2 &&
      populatedWorkbench.schema_row_actions.every(
        (action) =>
          action.label.length > 0 &&
          action.text.length === 0 &&
          action.opacity === '0' &&
          action.has_svg
      ),
    `schema namespace actions remain visually noisy or unlabeled (${JSON.stringify(populatedWorkbench.schema_row_actions)})`
  );
  assert(
    populatedWorkbench.schema_object_menus.length >= 2 &&
      populatedWorkbench.schema_object_menus.every(
        (action) =>
          action.label.length > 0 &&
          action.text.length === 0 &&
          action.opacity === '0' &&
          action.has_svg
      ),
    `schema object menus remain visually noisy or unlabeled (${JSON.stringify(populatedWorkbench.schema_object_menus)})`
  );
  assert(
    JSON.stringify(populatedWorkbench.visible_tabs) ===
      JSON.stringify(['fractions query', 'armors query', 'fractions']),
    `top tabs are not connection-scoped (${JSON.stringify(populatedWorkbench.visible_tabs)})`
  );
  assert(
    populatedWorkbench.topbar.height <= 56,
    'main header exceeds the compact 56px bound'
  );
  assert(
    JSON.stringify(
      populatedWorkbench.header_controls.map((control) => control.label)
    ) === JSON.stringify(['File', 'History', 'Settings']) &&
      Math.max(
        ...populatedWorkbench.header_controls.map((control) => control.height)
      ) -
        Math.min(
          ...populatedWorkbench.header_controls.map((control) => control.height)
        ) <=
        1 &&
      populatedWorkbench.header_controls.every(
        (control) => control.border === 'rgba(0, 0, 0, 0)'
      ),
    `application utilities do not form one quiet control tier (${JSON.stringify(populatedWorkbench.header_controls)})`
  );
  assert(
    populatedWorkbench.brand.right <=
      populatedWorkbench.header_controls[0].left &&
      populatedWorkbench.header_controls[0].right <=
        populatedWorkbench.connection_summary.left &&
      populatedWorkbench.connection_summary.right <=
        populatedWorkbench.header_controls[1].left &&
      populatedWorkbench.header_controls[1].right <=
        populatedWorkbench.header_controls[2].left &&
      populatedWorkbench.connection_summary_background !==
        populatedWorkbench.topbar_background,
    'header does not separate document navigation, connection status, and global utilities'
  );

  await workbenchPage.locator('.topbar').screenshot({
    path: headerScreenshotPath
  });
  const fileTrigger = workbenchPage.getByRole('button', {
    name: 'File',
    exact: true
  });
  await fileTrigger.click();
  const fileMenu = workbenchPage.getByRole('menu', { name: 'File' });
  await fileMenu.getByRole('menuitem', { name: /New query/ }).waitFor();
  const fileMenuLayout = await workbenchPage.evaluate(() => {
    const trigger = document
      .querySelector('.file-trigger')
      ?.getBoundingClientRect();
    const menu = document
      .querySelector('.file-menu-popover')
      ?.getBoundingClientRect();
    if (!trigger || !menu) throw new Error('File menu geometry is incomplete');
    return {
      trigger: trigger.toJSON(),
      menu: menu.toJSON(),
      viewport_width: window.innerWidth
    };
  });
  assert(
    fileMenuLayout.menu.top >= fileMenuLayout.trigger.bottom &&
      fileMenuLayout.menu.left >= 0 &&
      fileMenuLayout.menu.right <= fileMenuLayout.viewport_width,
    `File menu escaped its product-side trigger (${JSON.stringify(fileMenuLayout)})`
  );
  await fileTrigger.press('Escape');
  await fileMenu.waitFor({ state: 'detached' });
  assert(
    await fileTrigger.evaluate((element) => document.activeElement === element),
    'Escape did not return focus to the File trigger'
  );
  populatedWorkbench.file_menu = fileMenuLayout;
  assert(
    populatedWorkbench.toolbar_group_count === 2,
    'query actions are not split into two clear groups'
  );
  assert(
    populatedWorkbench.document_group.left >=
      populatedWorkbench.execution_group.right,
    'document controls are not visually separated from execution controls'
  );
  assert(
    Math.max(
      ...populatedWorkbench.execution_controls.map((control) => control.height)
    ) -
      Math.min(
        ...populatedWorkbench.execution_controls.map(
          (control) => control.height
        )
      ) <=
      1,
    `execution controls have unstable heights (${JSON.stringify(populatedWorkbench.execution_controls)})`
  );
  assert(
    populatedWorkbench.execution_controls[0].background !==
      populatedWorkbench.execution_controls[1].background,
    'Run is not visually distinct from the secondary Run all action'
  );
  assert(
    JSON.stringify(
      populatedWorkbench.result_actions.map((control) => control.label)
    ) === JSON.stringify(['Copy rows', 'Open value', 'Export']) &&
      Math.max(
        ...populatedWorkbench.result_actions.map((control) => control.height)
      ) -
        Math.min(
          ...populatedWorkbench.result_actions.map((control) => control.height)
        ) <=
        1,
    `result actions do not form one consistent control tier (${JSON.stringify(populatedWorkbench.result_actions)})`
  );
  assert(
    populatedWorkbench.result_context === '1 result set · succeeded' &&
      populatedWorkbench.loaded_label === '1 loaded row',
    `result status is duplicated or unclear (${populatedWorkbench.result_context}; ${populatedWorkbench.loaded_label})`
  );
  assert(
    populatedWorkbench.footer_shortcuts ===
      'Ctrl+Enter Run · Ctrl+Shift+Enter Run all · Ctrl+Tab Switch tabs',
    'status bar shortcut help is not compact'
  );
  assert(
    populatedWorkbench.editor.bottom <= populatedWorkbench.separator.top + 1,
    'editor overlaps the result separator'
  );
  assert(
    populatedWorkbench.results.top >= populatedWorkbench.separator.bottom - 1,
    'results do not begin directly below the separator'
  );
  assert(
    populatedWorkbench.results_heading.top < populatedWorkbench.grid_header.top,
    'result heading is not above the grid'
  );
  assert(
    populatedWorkbench.grid_viewport.height >= 34,
    'populated result viewport cannot display one complete row'
  );
  assert(
    populatedWorkbench.first_row.top >=
      populatedWorkbench.grid_header.bottom - 1 &&
      populatedWorkbench.first_row.bottom <= populatedWorkbench.results.bottom,
    'first received result row is outside the visible results pane'
  );
  assert(
    populatedWorkbench.results.bottom <= populatedWorkbench.footer.top,
    'results overlap the status bar'
  );
  assert(
    populatedWorkbench.result_column_widths.id <= 90 &&
      populatedWorkbench.result_column_widths.id <
        populatedWorkbench.result_column_widths.armor &&
      Math.abs(populatedWorkbench.result_column_widths.armor - 180) <= 1,
    `result columns are not value-aware and capped (${JSON.stringify(populatedWorkbench.result_column_widths)})`
  );
  assert(
    populatedWorkbench.table_font_size === '13px' &&
      /Mono|monospace/i.test(populatedWorkbench.table_font_family),
    `saved table typography did not reach the result grid (${populatedWorkbench.table_font_family} ${populatedWorkbench.table_font_size})`
  );

  const copyMenu = workbenchPage.locator('.copy-options');
  const exportMenu = workbenchPage.locator('.export-options');
  await copyMenu.locator('summary').click();
  await copyMenu
    .getByRole('button', { name: 'Loaded rows', exact: true })
    .waitFor();
  await exportMenu.locator('summary').click();
  await exportMenu
    .getByText('CSV keeps raw spreadsheet-formula prefixes')
    .waitFor();
  const resultMenuState = await workbenchPage.evaluate(() => {
    const copy = document.querySelector('.copy-options');
    const exportOptions = document.querySelector('.export-options');
    const popover = exportOptions
      ?.querySelector('.action-popover')
      ?.getBoundingClientRect();
    const results = document
      .querySelector('#query-results')
      ?.getBoundingClientRect();
    if (!(copy instanceof HTMLDetailsElement))
      throw new Error('copy menu is missing');
    if (!(exportOptions instanceof HTMLDetailsElement) || !popover || !results)
      throw new Error('export menu geometry is incomplete');
    return {
      copy_open: copy.open,
      export_open: exportOptions.open,
      popover: popover.toJSON(),
      results: results.toJSON()
    };
  });
  assert(
    !resultMenuState.copy_open &&
      resultMenuState.export_open &&
      resultMenuState.popover.left >= resultMenuState.results.left &&
      resultMenuState.popover.right <= resultMenuState.results.right,
    `result action menus overlap or escape the pane (${JSON.stringify(resultMenuState)})`
  );
  await exportMenu.locator('summary').click();
  populatedWorkbench.result_action_menus = resultMenuState;

  const horizontalScrollers = await workbenchPage.evaluate(() =>
    ['.grid-shell', '.grid-header-viewport', '.grid-viewport']
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement))
          throw new Error(`Missing result scroll surface ${selector}`);
        return {
          selector,
          overflow_x: getComputedStyle(element).overflowX,
          client_width: element.clientWidth,
          scroll_width: element.scrollWidth
        };
      })
      .filter(
        (surface) =>
          ['auto', 'scroll'].includes(surface.overflow_x) &&
          surface.scroll_width > surface.client_width
      )
  );
  assert(
    JSON.stringify(horizontalScrollers.map((surface) => surface.selector)) ===
      JSON.stringify(['.grid-viewport']),
    `result grid exposes competing horizontal scrollers (${JSON.stringify(horizontalScrollers)})`
  );
  await workbenchPage.locator('.grid-viewport').evaluate((element) => {
    element.scrollLeft = 280;
    element.dispatchEvent(new Event('scroll'));
  });
  await workbenchPage.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  const scrolledGridAlignment = await workbenchPage.evaluate(() => {
    const header = document.querySelector(
      '.grid-header [role="columnheader"]:nth-child(3)'
    );
    const cell = document.querySelector(
      '.grid-row [role="gridcell"]:nth-child(3)'
    );
    const viewport = document.querySelector('.grid-viewport');
    const headerRow = document.querySelector('.grid-header');
    if (!header || !cell || !(viewport instanceof HTMLElement) || !headerRow)
      throw new Error('result alignment geometry is incomplete');
    const headerRect = header.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    return {
      scroll_left: viewport.scrollLeft,
      header_left: headerRect.left,
      header_width: headerRect.width,
      cell_left: cellRect.left,
      cell_width: cellRect.width,
      header_transform: getComputedStyle(headerRow).transform
    };
  });
  assert(
    scrolledGridAlignment.scroll_left > 0 &&
      Math.abs(
        scrolledGridAlignment.header_left - scrolledGridAlignment.cell_left
      ) < 1 &&
      Math.abs(
        scrolledGridAlignment.header_width - scrolledGridAlignment.cell_width
      ) < 1,
    `result header and rows drift after horizontal scrolling (${JSON.stringify(scrolledGridAlignment)})`
  );
  await workbenchPage.locator('.grid-viewport').evaluate((element) => {
    element.scrollLeft = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  populatedWorkbench.horizontal_scrollers = horizontalScrollers;
  populatedWorkbench.scrolled_grid_alignment = scrolledGridAlignment;

  const selectedRowCheckbox = workbenchPage.getByRole('checkbox', {
    name: 'Select loaded row 1'
  });
  await selectedRowCheckbox.check();
  await workbenchPage
    .getByRole('button', { name: 'Copy selected', exact: true })
    .waitFor();
  const rowSelectionActions = await workbenchPage.evaluate(() => ({
    selected_label:
      document.querySelector('.selection-label')?.textContent?.trim() ?? '',
    selected_row_count: document.querySelectorAll('.grid-row.selected').length,
    copy_selected: Boolean(
      Array.from(document.querySelectorAll('.result-tools button')).find(
        (button) => button.textContent?.trim() === 'Copy selected'
      )
    ),
    clear_selection: Boolean(
      Array.from(document.querySelectorAll('.result-tools button')).find(
        (button) => button.textContent?.trim() === 'Clear selection'
      )
    )
  }));
  assert(
    rowSelectionActions.selected_label === '1 row selected' &&
      rowSelectionActions.selected_row_count === 1 &&
      rowSelectionActions.copy_selected &&
      rowSelectionActions.clear_selection,
    `row selection has no visible purpose (${JSON.stringify(rowSelectionActions)})`
  );
  await workbenchPage.screenshot({ path: rowSelectionScreenshotPath });
  await workbenchPage
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();

  const armorCell = workbenchPage.getByRole('gridcell').nth(5);
  await armorCell.click();
  const openValueButton = workbenchPage.getByRole('button', {
    name: 'Open value',
    exact: true
  });
  assert(
    await openValueButton.isEnabled(),
    'focusing a result field did not enable Open value'
  );
  await openValueButton.click();
  const valueViewer = workbenchPage.locator('.value-viewer');
  await valueViewer.waitFor();
  await workbenchPage
    .getByRole('button', { name: 'Close value viewer' })
    .click();
  await valueViewer.waitFor({ state: 'detached' });
  await armorCell.click({ button: 'right' });
  await valueViewer.waitFor();
  const valueViewerLayout = await workbenchPage.evaluate(() => {
    const viewer = document
      .querySelector('.value-viewer')
      ?.getBoundingClientRect();
    const grid = document.querySelector('.grid-shell')?.getBoundingClientRect();
    const results = document
      .querySelector('#query-results')
      ?.getBoundingClientRect();
    const value = document.querySelector('.value-viewer pre');
    const focused = document.querySelector(
      '.grid-row [role="gridcell"][aria-selected="true"]'
    );
    if (!viewer || !grid || !results || !value || !focused) {
      throw new Error('result value viewer geometry is incomplete');
    }
    const style = getComputedStyle(value);
    return {
      viewer: viewer.toJSON(),
      grid: grid.toJSON(),
      results: results.toJSON(),
      text: value.textContent ?? '',
      text_area: value.getBoundingClientRect().toJSON(),
      white_space: style.whiteSpace,
      overflow_wrap: style.overflowWrap,
      viewer_count: document.querySelectorAll('.value-viewer').length,
      document_scroll_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth
    };
  });
  assert(
    valueViewerLayout.viewer_count === 1 &&
      valueViewerLayout.viewer.left >= valueViewerLayout.grid.right - 1 &&
      valueViewerLayout.viewer.right <= valueViewerLayout.results.right &&
      valueViewerLayout.viewer.bottom <= valueViewerLayout.results.bottom &&
      valueViewerLayout.text_area.height >= 55,
    `value viewer is not a bounded side subtab (${JSON.stringify(valueViewerLayout)})`
  );
  assert(
    valueViewerLayout.text.includes('"serial": 900719925474099312345') &&
      valueViewerLayout.text.includes('\n') &&
      valueViewerLayout.white_space === 'pre-wrap' &&
      ['anywhere', 'break-word'].includes(valueViewerLayout.overflow_wrap),
    'value viewer did not soft-wrap formatted JSON while preserving the exact integer token'
  );
  assert(
    valueViewerLayout.document_scroll_width <= valueViewerLayout.viewport_width,
    'value viewer introduced page-level overflow'
  );
  await workbenchPage.screenshot({ path: valueViewerScreenshotPath });
  await workbenchPage
    .getByRole('button', { name: 'Close value viewer' })
    .click();
  populatedWorkbench.row_selection = rowSelectionActions;
  populatedWorkbench.value_viewer = valueViewerLayout;

  const separator = workbenchPage.locator('.results-separator');
  const measureSplit = () =>
    workbenchPage.evaluate(() => {
      const editor = document
        .querySelector('#query-editor-pane')
        ?.getBoundingClientRect();
      const results = document
        .querySelector('#query-results')
        ?.getBoundingClientRect();
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      if (!editor || !results || !footer)
        throw new Error('split geometry is incomplete');
      return {
        editor_height: editor.height,
        results_height: results.height,
        editor_bottom: editor.bottom,
        results_top: results.top,
        results_bottom: results.bottom,
        footer_top: footer.top
      };
    });
  await separator.focus();
  await separator.press('Home');
  const split20 = await measureSplit();
  await separator.press('End');
  const split70 = await measureSplit();
  await separator.dblclick();
  const split35 = await measureSplit();
  assert(
    split20.results_height < split35.results_height &&
      split35.results_height < split70.results_height,
    `result split bounds are not ordered (${split20.results_height}, ${split35.results_height}, ${split70.results_height})`
  );
  for (const [label, split] of [
    ['20%', split20],
    ['35%', split35],
    ['70%', split70]
  ]) {
    assert(
      split.editor_height > 0 &&
        split.results_height > 0 &&
        split.editor_bottom <= split.results_top &&
        split.results_bottom <= split.footer_top,
      `${label} result split escaped the workbench`
    );
  }
  populatedWorkbench.split_geometry = {
    results_20_percent: split20,
    results_35_percent: split35,
    results_70_percent: split70
  };
  await workbenchPage.screenshot({ path: workbenchScreenshotPath });
  await workbenchPage
    .locator('aside')
    .screenshot({ path: sidebarScreenshotPath });
  const firstSchemaObjectMenu = workbenchPage
    .locator('.schema-tree .schema-object-menu')
    .first();
  const firstSchemaObject = firstSchemaObjectMenu.locator('..');
  await firstSchemaObject.hover();
  const schemaMenuOnHover = await firstSchemaObjectMenu.evaluate(
    (element) => getComputedStyle(element).opacity
  );
  assert(
    schemaMenuOnHover === '1',
    `schema object menu does not reveal on hover (${schemaMenuOnHover})`
  );
  const firstSchemaMenuTrigger = firstSchemaObject.getByRole('button', {
    name: /More actions for/
  });
  await firstSchemaMenuTrigger.focus();
  assert(
    (await firstSchemaObjectMenu.evaluate(
      (element) => getComputedStyle(element).opacity
    )) === '1',
    'schema object menu does not remain visible to keyboard focus'
  );
  await workbenchPage.locator('.topbar').hover();

  const mainBeforeHistory = await workbenchPage
    .locator('main')
    .evaluate((element) => element.getBoundingClientRect().toJSON());
  const historyTrigger = workbenchPage.getByRole('button', {
    name: 'History',
    exact: true
  });
  await historyTrigger.click();
  const historyDrawer = workbenchPage.locator('#history-drawer');
  await historyDrawer.waitFor();
  await workbenchPage
    .getByRole('button', { name: /open completed query from Emissary/i })
    .waitFor();
  const historyOverlay = await workbenchPage.evaluate(() => {
    const main = document.querySelector('main')?.getBoundingClientRect();
    const workbench = document
      .querySelector('.workbench')
      ?.getBoundingClientRect();
    const drawer = document
      .querySelector('#history-drawer')
      ?.getBoundingClientRect();
    const search = document.querySelector(
      '#history-drawer input[type="search"]'
    );
    const entryCode = document.querySelector('.history-main code');
    const deleteButton = document.querySelector('.history-delete');
    const closeButton = document.querySelector('.close-button');
    if (!main || !workbench || !drawer || !search)
      throw new Error('history overlay geometry is incomplete');
    return {
      main: main.toJSON(),
      workbench: workbench.toJSON(),
      drawer: drawer.toJSON(),
      search_focused: document.activeElement === search,
      heading_context:
        document
          .querySelector('.history-heading-copy > p')
          ?.textContent?.trim() ?? '',
      entry_profile:
        document
          .querySelector('.history-entry-heading strong')
          ?.textContent?.trim() ?? '',
      entry_status:
        document.querySelector('.history-status')?.textContent?.trim() ?? '',
      entry_sql_white_space: entryCode
        ? getComputedStyle(entryCode).whiteSpace
        : '',
      open_label:
        document.querySelector('.history-open-label')?.textContent?.trim() ??
        '',
      privacy_summary:
        document
          .querySelector('.history-privacy summary')
          ?.textContent?.trim() ?? '',
      control_heights: [deleteButton, closeButton].map(
        (element) => element?.getBoundingClientRect().height ?? 0
      ),
      document_scroll_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth
    };
  });
  assert(
    Math.abs(historyOverlay.main.width - mainBeforeHistory.width) < 1 &&
      Math.abs(historyOverlay.main.left - mainBeforeHistory.left) < 1,
    'opening History resized the main workbench pane'
  );
  assert(
    Math.abs(historyOverlay.drawer.right - historyOverlay.workbench.right) <
      1 &&
      historyOverlay.drawer.top >= historyOverlay.workbench.top &&
      historyOverlay.drawer.bottom <= historyOverlay.workbench.bottom,
    'History drawer escaped the workbench right edge'
  );
  assert(historyOverlay.search_focused, 'History did not focus search on open');
  assert(
    historyOverlay.heading_context === 'Queries saved on this device' &&
      historyOverlay.entry_profile === 'Emissary' &&
      historyOverlay.entry_status === 'Completed' &&
      historyOverlay.entry_sql_white_space === 'pre-wrap' &&
      historyOverlay.open_label === 'Open query' &&
      historyOverlay.privacy_summary ===
        'Stored locally · SQL and metadata only',
    `History hierarchy or intent is unclear (${JSON.stringify(historyOverlay)})`
  );
  assert(
    Math.max(...historyOverlay.control_heights) -
      Math.min(...historyOverlay.control_heights) <=
      1,
    `History icon controls use inconsistent sizing (${JSON.stringify(historyOverlay.control_heights)})`
  );
  assert(
    historyOverlay.document_scroll_width <= historyOverlay.viewport_width,
    'History drawer introduced page-level horizontal overflow'
  );
  await workbenchPage.screenshot({ path: historyScreenshotPath });
  await historyDrawer.screenshot({ path: historyDrawerScreenshotPath });
  await workbenchPage.locator('.history-privacy summary').click();
  assert(
    await workbenchPage.locator('.history-privacy p').isVisible(),
    'History privacy guidance does not expand on request'
  );
  await workbenchPage
    .getByRole('button', { name: 'Clear all history…' })
    .click();
  await workbenchPage
    .getByRole('button', { name: 'Keep', exact: true })
    .click();
  assert(
    (await workbenchPage.locator('.confirm-strip').count()) === 0,
    'History clear confirmation does not return to the safe state'
  );
  await workbenchPage
    .locator('#history-drawer input[type="search"]')
    .press('Escape');
  await historyDrawer.waitFor({ state: 'detached' });
  assert(
    await historyTrigger.evaluate(
      (element) => document.activeElement === element
    ),
    'Escape did not return focus to the History trigger'
  );
  await historyTrigger.click();
  await historyDrawer.waitFor();
  await workbenchPage
    .locator('.history-scrim')
    .click({ position: { x: 8, y: 8 } });
  await historyDrawer.waitFor({ state: 'detached' });
  assert(
    await historyTrigger.evaluate(
      (element) => document.activeElement === element
    ),
    'backdrop click did not return focus to the History trigger'
  );
  populatedWorkbench.history_overlay = historyOverlay;

  const populatedResponsiveLayouts = [];
  for (const width of widths) {
    await workbenchPage.setViewportSize({ width, height: 800 });
    const layout = await workbenchPage.evaluate(() => {
      const main = document.querySelector('main')?.getBoundingClientRect();
      const results = document
        .querySelector('#query-results')
        ?.getBoundingClientRect();
      const firstRow = document
        .querySelector('.grid-row')
        ?.getBoundingClientRect();
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      const topbar = document.querySelector('.topbar');
      const brandContext = document.querySelector('.brand-context');
      if (!main || !results || !firstRow || !footer)
        throw new Error('responsive workbench geometry is incomplete');
      return {
        viewport_width: window.innerWidth,
        document_scroll_width: document.documentElement.scrollWidth,
        main: main.toJSON(),
        results: results.toJSON(),
        first_row: firstRow.toJSON(),
        footer: footer.toJSON(),
        topbar_client_width: topbar?.clientWidth ?? 0,
        topbar_scroll_width: topbar?.scrollWidth ?? 0,
        brand_context_display: brandContext
          ? getComputedStyle(brandContext).display
          : 'missing',
        header_controls: Array.from(
          document.querySelectorAll('.topbar-control')
        ).map((element) => element.textContent?.trim() ?? ''),
        visible_tabs: Array.from(
          document.querySelectorAll('[role="tab"] .tab-title')
        ).map((element) => element.textContent?.trim() ?? '')
      };
    });
    assert(
      layout.document_scroll_width <= layout.viewport_width,
      `${width}px populated workbench has page-level horizontal overflow`
    );
    assert(
      layout.topbar_scroll_width <= layout.topbar_client_width &&
        JSON.stringify(layout.header_controls) ===
          JSON.stringify(['File', 'History', 'Settings']),
      `${width}px application header clipped or lost a utility`
    );
    if (width === 720) {
      assert(
        layout.brand_context_display === 'none',
        '720px header did not prioritize product and utility controls'
      );
    }
    assert(
      layout.results.bottom <= layout.footer.top &&
        layout.first_row.bottom <= layout.results.bottom,
      `${width}px populated result escaped its workbench pane`
    );
    assert(
      JSON.stringify(layout.visible_tabs) ===
        JSON.stringify(['fractions query', 'armors query', 'fractions']),
      `${width}px populated tabs lost connection scope`
    );
    if (width === 720) {
      await workbenchPage.screenshot({ path: compactWorkbenchScreenshotPath });
    }
    populatedResponsiveLayouts.push(layout);
  }

  await workbenchPage.setViewportSize({ width: 1280, height: 800 });
  const populatedScale150 = await workbenchPage.evaluate(async () => {
    const shell = document.querySelector('.app-shell');
    if (!(shell instanceof HTMLElement))
      throw new Error('scaled workbench shell is missing');
    shell.style.setProperty('--ui-scale', '1.5');
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const main = document.querySelector('main')?.getBoundingClientRect();
    const results = document
      .querySelector('#query-results')
      ?.getBoundingClientRect();
    const footer = document.querySelector('footer')?.getBoundingClientRect();
    if (!main || !results || !footer)
      throw new Error('150% workbench geometry is incomplete');
    const layout = {
      document_scroll_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth,
      main: main.toJSON(),
      results: results.toJSON(),
      footer: footer.toJSON(),
      transform: getComputedStyle(shell).transform
    };
    shell.style.setProperty('--ui-scale', '1');
    return layout;
  });
  assert(
    populatedScale150.transform.startsWith('matrix(1.5'),
    `populated workbench did not render at 150% (${populatedScale150.transform})`
  );
  assert(
    populatedScale150.document_scroll_width <= populatedScale150.viewport_width,
    '150% populated workbench has page-level horizontal overflow'
  );
  assert(
    populatedScale150.results.bottom <= populatedScale150.footer.top,
    '150% populated results overlap the status bar'
  );
  populatedWorkbench.responsive_layouts = populatedResponsiveLayouts;
  populatedWorkbench.scale_150_percent = populatedScale150;
  populatedWorkbench.schema_structure = schemaStructure;
  populatedWorkbench.initial_alignment = initialWorkbenchAlignment;
  populatedWorkbench.connection_action_menu = connectionActionMenu;
  populatedWorkbench.schema_namespace_layout = schemaNamespaceLayout;

  const createdTabsBeforeClose = await workbenchPage.evaluate(
    () =>
      window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
        (entry) => entry.command === 'create_offline_tab'
      ).length
  );
  await workbenchPage.getByRole('tab', { name: /armors query/i }).click();
  await workbenchPage.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.tab-state')).some((element) =>
        element.textContent?.includes('Opening')
      )
  );
  await workbenchPage
    .getByRole('button', { name: 'Close armors query' })
    .click();
  const closeDialog = workbenchPage.locator('.modal-card');
  await closeDialog.waitFor();
  await closeDialog
    .getByRole('button', {
      name: 'Discard unsaved changes and close',
      exact: true
    })
    .click();
  await closeDialog.waitFor({ state: 'detached' });
  const localTabClose = await workbenchPage.evaluate(() => ({
    active_tab:
      document
        .querySelector('.workspace-tab-item.active .tab-title')
        ?.textContent?.trim() ?? '',
    visible_tabs: Array.from(
      document.querySelectorAll('.workspace-tab-item .tab-title')
    ).map((element) => element.textContent?.trim() ?? ''),
    offline_selected: document
      .querySelector('[data-profile-id="offline"]')
      ?.getAttribute('aria-current'),
    created_tabs_after: window.__QUERYNOT_FIXTURE_COMMANDS__.filter(
      (entry) => entry.command === 'create_offline_tab'
    ).length
  }));
  localTabClose.created_tabs_before = createdTabsBeforeClose;
  assert(
    localTabClose.active_tab === 'fractions query' &&
      !localTabClose.visible_tabs.includes('offline notes') &&
      localTabClose.offline_selected !== 'true' &&
      localTabClose.created_tabs_after === localTabClose.created_tabs_before,
    `closing an active query left its connection group (${JSON.stringify(localTabClose)})`
  );
  populatedWorkbench.local_tab_close = localTabClose;
  await workbenchPage.close();

  mkdirSync(dirname(reportPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.locator('.settings-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.screenshot({
    path: settingsUpdatesScreenshotPath,
    fullPage: true
  });
  const report = {
    schema_version: 1,
    status: 'pass',
    source_commit: sourceCommit,
    tested_at: new Date().toISOString(),
    viewport_height: 1068,
    layouts,
    dialog_themes: dialogThemes,
    settings_hierarchy: settingsHierarchy,
    scale_preview: {
      baseline: baselineScale,
      scaled: scalePreview,
      reopened_200_percent: highScaleDialog
    },
    connection_dialog: connectionDialog,
    editor_focus: editorFocus,
    populated_workbench: populatedWorkbench,
    theme_labels: options,
    screenshots: [
      'artifacts/ui-layout-settings.png',
      'artifacts/ui-layout-settings-updates.png',
      'artifacts/ui-layout-settings-200.png',
      'artifacts/ui-layout-connection-server.png',
      'artifacts/ui-layout-connection-security.png',
      'artifacts/ui-layout-connection-file.png',
      'artifacts/ui-layout-connection-200.png',
      'artifacts/ui-layout-autocomplete.png',
      'artifacts/ui-layout-workbench.png',
      'artifacts/ui-layout-workbench-150.png',
      'artifacts/ui-layout-value-viewer.png',
      'artifacts/ui-layout-row-selection.png',
      'artifacts/ui-layout-workbench-720.png',
      'artifacts/ui-layout-header.png',
      'artifacts/ui-layout-schema-150.png',
      'artifacts/ui-layout-history.png',
      'artifacts/ui-layout-sidebar.png',
      'artifacts/ui-layout-connection-menu.png',
      'artifacts/ui-layout-schema-menu.png',
      'artifacts/ui-layout-history-drawer.png'
    ]
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `UI layout passed at ${widths.join(', ')}px with opaque dialogs in ${themes.join(', ')} themes\n`
  );
} finally {
  await browser?.close();
  await server.close();
}
