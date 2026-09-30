import { expect, test } from '@playwright/test'

const liveVdoEnabled = process.env.STUDY6_LIVE_VDO_E2E === '1'

test.describe('private companion live transport', () => {
  test.skip(
    !liveVdoEnabled,
    'Set STUDY6_LIVE_VDO_E2E=1 to exercise the public VDO.Ninja signaling service.',
  )

  test('authenticates in an isolated phone context and reconnects from trusted storage', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const targetContext = await browser.newContext()
    const phoneContext = await browser.newContext()

    try {
      const targetPage = await targetContext.newPage()
      await targetPage.goto('./?sensor=disabled-rehearsal')

      const privateLink = targetPage.locator('#study6-companion-link')
      await expect(privateLink).toHaveValue(/#pair=/u)
      const pairingUrl = await privateLink.inputValue()

      // The descriptor is kept only in memory. Playwright screenshots, video,
      // and traces are disabled in the config so it cannot enter artifacts.
      const parsedPairingUrl = new URL(pairingUrl)
      expect(parsedPairingUrl.origin).toBe('http://127.0.0.1:4174')
      expect(parsedPairingUrl.pathname).toBe('/spatial-study-6-webxr/companion.html')
      expect(parsedPairingUrl.hash).toMatch(/^#pair=/u)

      const phonePage = await phoneContext.newPage()
      await phonePage.goto(pairingUrl)

      await expect.poll(() => phonePage.evaluate(() => location.hash)).toBe('')
      await expect(phonePage.locator('#route-badge')).toHaveText('BRSP authenticated')
      await expect(phonePage.locator('[data-field="scopes"]')).toContainText(
        'study.status.read',
      )
      await expect(phonePage.locator('[data-field="controller-network-route"]'))
        .toHaveText(/Direct WebRTC|TURN relay/u)
      await expect(phonePage.locator('[data-field="controller-network-rtt"]'))
        .toHaveText(/^\d+ ms$/u)
      await expect(phonePage.locator('[data-field="target-network-route"]'))
        .toHaveText(/Direct WebRTC|TURN relay/u)
      await expect(phonePage.locator('[data-field="target-network-rtt"]'))
        .toHaveText(/^\d+ ms$/u)
      await expect
        .poll(() =>
          phonePage.evaluate(() =>
            localStorage.getItem('study6.trusted-operator.v2') !== null,
          ),
        )
        .toBe(true)

      // End the current protocol epoch cleanly and wait for the headset target
      // to rearm. This removes a page-navigation race from the live signaling
      // test while still exercising a second, fresh WebRTC + BRSP connection.
      await phonePage.locator('#disconnect').click()
      await expect(phonePage.locator('#route-badge')).toHaveText('Offline')
      await expect(targetPage.getByRole('button', { name: /Companion ready · 0/u }))
        .toBeVisible()

      // A later bare visit must recover the private descriptor from this
      // phone browser's storage; public discovery is never used as a key.
      await phonePage.goto('./companion.html')
      await expect.poll(() => phonePage.evaluate(() => location.hash)).toBe('')
      await expect(phonePage.locator('#route-badge')).toHaveText('BRSP authenticated')
      await expect(phonePage.locator('[data-field="scopes"]')).toContainText(
        'study.status.read',
      )
      await expect(phonePage.locator('[data-field="controller-network-route"]'))
        .toHaveText(/Direct WebRTC|TURN relay/u)
      await expect(phonePage.locator('[data-field="target-network-route"]'))
        .toHaveText(/Direct WebRTC|TURN relay/u)
    } finally {
      await Promise.allSettled([
        phoneContext.close(),
        targetContext.close(),
      ])
    }
  })
})
