import { chromium } from '@playwright/test'

const targetUrl = 'http://127.0.0.1:4174/spatial-study-6-webxr/?sensor=disabled-rehearsal'
const targetBaseUrl = 'http://127.0.0.1:4174/spatial-study-6-webxr/'
const companionUrl = 'http://127.0.0.1:4174/spatial-study-6-webxr/companion.html'
const timeoutMs = 120_000

function cdpEndpoint() {
  const value = process.env.STUDY6_QUEST_CDP_ENDPOINT ?? ''
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/u.test(value)) {
    throw new Error('Set STUDY6_QUEST_CDP_ENDPOINT to a forwarded localhost CDP endpoint.')
  }
  return value
}

async function waitForText(page, selector, predicate, description) {
  const locator = page.locator(selector)
  await locator.waitFor({ state: 'attached', timeout: timeoutMs })
  const deadline = Date.now() + timeoutMs
  let latest = ''
  while (Date.now() < deadline) {
    latest = (await locator.textContent())?.trim() ?? ''
    if (predicate(latest)) return latest
    await page.waitForTimeout(250)
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function waitForInputValue(page, selector, predicate, description) {
  const locator = page.locator(selector)
  await locator.waitFor({ state: 'attached', timeout: timeoutMs })
  const deadline = Date.now() + timeoutMs
  let latest = ''
  while (Date.now() < deadline) {
    latest = await locator.inputValue()
    if (predicate(latest)) return latest
    await page.waitForTimeout(250)
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function collectPeerQuality(page) {
  const controllerRoute = await waitForText(
    page,
    '[data-field="controller-network-route"]',
    (value) => value === 'Direct WebRTC' || value === 'TURN relay',
    'the controller-observed WebRTC route',
  )
  const controllerRtt = await waitForText(
    page,
    '[data-field="controller-network-rtt"]',
    (value) => /^\d+ ms$/u.test(value),
    'the controller-observed RTT',
  )
  const targetRoute = await waitForText(
    page,
    '[data-field="target-network-route"]',
    (value) => value === 'Direct WebRTC' || value === 'TURN relay',
    'the target-observed WebRTC route',
  )
  const targetRtt = await waitForText(
    page,
    '[data-field="target-network-rtt"]',
    (value) => /^\d+ ms$/u.test(value),
    'the target-observed RTT',
  )
  return { controllerRoute, controllerRtt, targetRoute, targetRtt }
}

function versionFromUserAgent(userAgent, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return userAgent.match(new RegExp(`${escaped}/([0-9.]+)`, 'u'))?.[1] ?? 'unknown'
}

async function run() {
  const startedAt = Date.now()
  let stage = 'connect_to_quest_browser'
  let phoneBrowser
  let phonePage
  try {
    const questBrowser = await chromium.connectOverCDP(cdpEndpoint())
    const questPages = questBrowser.contexts().flatMap((context) => context.pages())
    const targetPage = questPages
      .filter((page) => page.url().split(/[?#]/u)[0] === targetBaseUrl)
      .at(-1)
    if (!targetPage) throw new Error('No existing local Study 6 WebXR tab was found.')

    stage = 'reload_exact_candidate'
    await targetPage.bringToFront()
    await targetPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await targetPage.locator('#study6-companion-link').waitFor({
      state: 'attached',
      timeout: timeoutMs,
    })

    stage = 'obtain_private_pairing'
    const pairingUrl = await waitForInputValue(
      targetPage,
      '#study6-companion-link',
      (value) => value.startsWith(`${companionUrl}#pair=`),
      'the private in-memory pairing descriptor',
    )
    const parsedPairing = new URL(pairingUrl)
    if (parsedPairing.origin !== 'http://127.0.0.1:4174') {
      throw new Error('The pairing origin did not match the local qualification origin.')
    }
    if (!/^#pair=[A-Za-z0-9_-]+$/u.test(parsedPairing.hash)) {
      throw new Error('The pairing fragment was missing or malformed.')
    }

    stage = 'launch_isolated_controller'
    phoneBrowser = await chromium.launch({ headless: true })
    const phoneContext = await phoneBrowser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'en-US',
    })
    phonePage = await phoneContext.newPage()
    await phonePage.goto(pairingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await phonePage.waitForFunction(() => window.location.hash === '', undefined, {
      timeout: 10_000,
    })

    stage = 'authenticate_first_epoch'
    await waitForText(
      phonePage,
      '#route-badge',
      (value) => value === 'BRSP authenticated',
      'first-epoch BRSP authentication',
    )
    const scopeText = await waitForText(
      phonePage,
      '[data-field="scopes"]',
      (value) => value.includes('study.status.read'),
      'the negotiated Study 6 scope set',
    )
    const firstQuality = await collectPeerQuality(phonePage)

    stage = 'request_and_observe_status'
    await phonePage.locator('[data-command="request_status"]').click()
    const statusReceipt = await waitForText(
      phonePage,
      '#command-result',
      (value) => value.startsWith('Accepted') && value.includes('Fresh privacy-minimized status'),
      'the request-status acknowledgement',
    )

    stage = 'apply_safe_webxr_command'
    await phonePage.locator('[data-command="recenter_panel"]').click()
    const recenterReceipt = await waitForText(
      phonePage,
      '#command-result',
      (value) => value.startsWith('Accepted') && value.includes('Panel recentered'),
      'the WebXR-owned recenter acknowledgement',
    )
    await waitForText(
      targetPage,
      'button[title="Show trusted companion pairing and connection status"]',
      (value) => value.includes('Companion ready · 1'),
      'the target-side authenticated-controller projection',
    )

    stage = 'disconnect_and_reseed'
    await phonePage.locator('#disconnect').click()
    await waitForText(
      phonePage,
      '#route-badge',
      (value) => value === 'Offline',
      'the explicit controller disconnect',
    )
    await waitForText(
      targetPage,
      'button[title="Show trusted companion pairing and connection status"]',
      (value) => value.includes('Companion ready · 0'),
      'the target data-only re-seed',
    )

    stage = 'authenticate_saved_second_epoch'
    await phonePage.goto(companionUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await phonePage.waitForFunction(() => window.location.hash === '', undefined, {
      timeout: 10_000,
    })
    await waitForText(
      phonePage,
      '#route-badge',
      (value) => value === 'BRSP authenticated',
      'saved-descriptor BRSP reconnect',
    )
    const secondQuality = await collectPeerQuality(phonePage)

    stage = 'clean_controller_disconnect'
    await phonePage.locator('#disconnect').click()
    await waitForText(
      phonePage,
      '#route-badge',
      (value) => value === 'Offline',
      'the final controller disconnect',
    )

    const userAgent = await targetPage.evaluate(() => navigator.userAgent)
    return {
      schema: 'study6.quest_companion_qualification.v1',
      result: 'pass',
      protocol: 'BRSP/1',
      target: {
        platform: 'Meta Quest Browser',
        browserVersion: versionFromUserAgent(userAgent, 'OculusBrowser'),
        chromiumVersion: versionFromUserAgent(userAgent, 'Chrome'),
        source: 'existing CDP-exposed local WebXR tab',
      },
      controller: {
        platform: 'isolated Playwright Chromium phone viewport',
        browserVersion: phoneBrowser.version(),
        viewport: '390x844@2x',
      },
      negotiatedScopeCount: scopeText.split(',').filter(Boolean).length,
      firstEpoch: firstQuality,
      commands: {
        requestStatus: statusReceipt,
        recenterPanel: recenterReceipt,
      },
      savedReconnectEpoch: secondQuality,
      pairingFragmentScrubbed: true,
      artifactsRetained: false,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      schema: 'study6.quest_companion_qualification.v1',
      result: 'conditional',
      failedStage: stage,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      pairingMaterialExposed: false,
      artifactsRetained: false,
      elapsedMs: Date.now() - startedAt,
    }
  } finally {
    if (phonePage) await phonePage.close().catch(() => undefined)
    if (phoneBrowser) await phoneBrowser.close().catch(() => undefined)
    // Deliberately do not call close() on the CDP-attached Quest Browser.
    // Process exit drops only the debugging socket and preserves the user's app.
  }
}

const result = await run()
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => {
  process.exit(result.result === 'pass' ? 0 : 1)
})
