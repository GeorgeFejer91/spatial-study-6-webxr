interface DigitalGoodsWindow {
  getDigitalGoodsService?: unknown
}

/** Meta exposes Digital Goods only inside the verified packaged PWA scope. */
export function isVerifiedPackagedPwa(
  candidate: DigitalGoodsWindow = window as unknown as DigitalGoodsWindow,
): boolean {
  return candidate.getDigitalGoodsService !== undefined
}
