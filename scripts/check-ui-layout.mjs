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
    scalePreview.dialog_transform.startsWith('matrix(1.5'),
    `150% preview did not configure the complete dialog viewport (${scalePreview.dialog_transform})`
  );
  assert(
    scalePreview.topbar_height >= baselineScale.topbar_height * 1.45,
    `150% preview did not scale the application chrome (${baselineScale.topbar_height} -> ${scalePreview.topbar_height})`
  );
  assert(
    scalePreview.submit_height >= baselineScale.submit_height * 1.45,
    `150% preview did not scale dialog controls (${baselineScale.submit_height} -> ${scalePreview.submit_height})`
  );
  await page
    .locator('.modal-card input[type="range"]')
    .first()
    .evaluate((element) => {
      element.value = '100';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

  const sidebarOverflow = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (!aside) throw new Error('sidebar is missing');
    const list = document.createElement('ul');
    list.className = 'profile-list';
    list.innerHTML = `<li><button class="profile-main"><span class="engine-mark">SQ</span><span><strong>Very long synthetic connection name that must be clipped</strong><small>very-long-synthetic-database-file-name.sqlite3</small></span><span class="status-dot"></span></button><div class="profile-actions"><button>Test</button><button>Disconnect</button><button>Edit</button><button>Duplicate</button><button>Delete</button></div></li>`;
    aside.append(list);
    const result = {
      aside_client_width: aside.clientWidth,
      aside_scroll_width: aside.scrollWidth,
      actions_client_width:
        list.querySelector('.profile-actions')?.clientWidth ?? 0,
      actions_scroll_width:
        list.querySelector('.profile-actions')?.scrollWidth ?? 0
    };
    list.remove();
    return result;
  });
  assert(
    sidebarOverflow.aside_scroll_width <= sidebarOverflow.aside_client_width,
    'connection content overflows the sidebar'
  );
  assert(
    sidebarOverflow.actions_scroll_width <=
      sidebarOverflow.actions_client_width,
    'connection actions overflow their profile card'
  );

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
  await editorPage.close();

  mkdirSync(dirname(reportPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const report = {
    schema_version: 1,
    status: 'pass',
    source_commit: sourceCommit,
    tested_at: new Date().toISOString(),
    viewport_height: 1068,
    layouts,
    dialog_themes: dialogThemes,
    scale_preview: { baseline: baselineScale, scaled: scalePreview },
    sidebar_overflow: sidebarOverflow,
    editor_focus: editorFocus,
    theme_labels: options,
    screenshot: 'artifacts/ui-layout-settings.png'
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `UI layout passed at ${widths.join(', ')}px with opaque dialogs in ${themes.join(', ')} themes\n`
  );
} finally {
  await browser?.close();
  await server.close();
}
