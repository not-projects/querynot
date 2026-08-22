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
const workbenchScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-workbench.png'
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
const valueViewerScreenshotPath = resolve(
  root,
  'artifacts',
  'ui-layout-value-viewer.png'
);
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
    if (!(backdrop instanceof HTMLElement) || !(card instanceof HTMLElement)) {
      throw new Error('high-scale Settings dialog is missing');
    }
    const backdropBounds = backdrop.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    return {
      backdrop_transform: getComputedStyle(backdrop).transform,
      backdrop_top: backdropBounds.top,
      backdrop_bottom: backdropBounds.bottom,
      card_top: cardBounds.top,
      card_bottom: cardBounds.bottom,
      card_client_height: card.clientHeight,
      card_scroll_height: card.scrollHeight,
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
    highScaleDialog.card_scroll_height > highScaleDialog.card_client_height,
    '200% Settings dialog does not expose an internal scroll range'
  );

  const highScaleSave = page.getByRole('button', { name: 'Save settings' });
  await highScaleSave.scrollIntoViewIfNeeded();
  const highScaleSaveBounds = await highScaleSave.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  });
  assert(
    highScaleSaveBounds.top >= 0 && highScaleSaveBounds.bottom <= 600,
    'bottom Settings action cannot be scrolled into the 200% viewport'
  );
  const highScaleClose = page.getByRole('button', { name: 'Close' });
  await highScaleClose.scrollIntoViewIfNeeded();
  const highScaleCloseBounds = await highScaleClose.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  });
  assert(
    highScaleCloseBounds.top >= 0 && highScaleCloseBounds.bottom <= 600,
    'top Settings action cannot be scrolled back into the 200% viewport'
  );

  await page
    .locator('.modal-card input[type="range"]')
    .first()
    .evaluate((element) => {
      element.value = '100';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await highScaleSave.scrollIntoViewIfNeeded();
  await highScaleSave.click();
  await page.locator('.modal-card').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: widths[0], height: 1068 });
  await page.getByRole('button', { name: 'Settings' }).first().click();

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
  const initialWorkbenchAlignment = await workbenchPage.evaluate(() => {
    const editor = document.querySelector('#query-editor-pane');
    const documentActions = document.querySelector('.toolbar-document');
    const tabs = document.querySelector('.workspace-tabs');
    const newTab = document.querySelector('.new-tab');
    if (!editor || !documentActions || !tabs || !newTab) {
      throw new Error('initial workbench alignment controls are missing');
    }
    const editorBounds = editor.getBoundingClientRect();
    const documentBounds = documentActions.getBoundingClientRect();
    const tabsBounds = tabs.getBoundingClientRect();
    const newTabBounds = newTab.getBoundingClientRect();
    return {
      document_action_offset: documentBounds.left - editorBounds.left,
      new_tab_gap: newTabBounds.left - tabsBounds.right,
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
    if (!tabs || !newTab || !footer) {
      throw new Error('large-scale workbench controls are incomplete');
    }
    return {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      document_scroll_width: document.documentElement.scrollWidth,
      document_scroll_height: document.documentElement.scrollHeight,
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
    largeScaleAlignment.tab_widths.every((width) => width <= 230),
    `150% workspace tabs are still stretched (${JSON.stringify(largeScaleAlignment.tab_widths)})`
  );
  assert(
    largeScaleAlignment.footer_bottom <= largeScaleAlignment.viewport_height,
    '150% large workbench footer escaped the viewport'
  );
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
      visible_tabs: visibleTabs,
      topbar: rect('.topbar'),
      toolbar_group_count: document.querySelectorAll(
        '.query-toolbar > .toolbar-group'
      ).length,
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
    JSON.stringify(populatedWorkbench.visible_tabs) ===
      JSON.stringify(['fractions query', 'armors query', 'fractions']),
    `top tabs are not connection-scoped (${JSON.stringify(populatedWorkbench.visible_tabs)})`
  );
  assert(
    populatedWorkbench.topbar.height <= 56,
    'main header exceeds the compact 56px bound'
  );
  assert(
    populatedWorkbench.toolbar_group_count === 2,
    'query actions are not split into two clear groups'
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
    .getByRole('button', { name: /completed · Emissary/i })
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
    if (!main || !workbench || !drawer || !search)
      throw new Error('history overlay geometry is incomplete');
    return {
      main: main.toJSON(),
      workbench: workbench.toJSON(),
      drawer: drawer.toJSON(),
      search_focused: document.activeElement === search,
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
    historyOverlay.document_scroll_width <= historyOverlay.viewport_width,
    'History drawer introduced page-level horizontal overflow'
  );
  await workbenchPage.screenshot({ path: historyScreenshotPath });
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
      if (!main || !results || !firstRow || !footer)
        throw new Error('responsive workbench geometry is incomplete');
      return {
        viewport_width: window.innerWidth,
        document_scroll_width: document.documentElement.scrollWidth,
        main: main.toJSON(),
        results: results.toJSON(),
        first_row: firstRow.toJSON(),
        footer: footer.toJSON(),
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
      layout.results.bottom <= layout.footer.top &&
        layout.first_row.bottom <= layout.results.bottom,
      `${width}px populated result escaped its workbench pane`
    );
    assert(
      JSON.stringify(layout.visible_tabs) ===
        JSON.stringify(['fractions query', 'armors query', 'fractions']),
      `${width}px populated tabs lost connection scope`
    );
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
  const report = {
    schema_version: 1,
    status: 'pass',
    source_commit: sourceCommit,
    tested_at: new Date().toISOString(),
    viewport_height: 1068,
    layouts,
    dialog_themes: dialogThemes,
    scale_preview: {
      baseline: baselineScale,
      scaled: scalePreview,
      reopened_200_percent: highScaleDialog
    },
    editor_focus: editorFocus,
    populated_workbench: populatedWorkbench,
    theme_labels: options,
    screenshots: [
      'artifacts/ui-layout-settings.png',
      'artifacts/ui-layout-autocomplete.png',
      'artifacts/ui-layout-workbench.png',
      'artifacts/ui-layout-workbench-150.png',
      'artifacts/ui-layout-value-viewer.png',
      'artifacts/ui-layout-schema-150.png',
      'artifacts/ui-layout-history.png'
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
