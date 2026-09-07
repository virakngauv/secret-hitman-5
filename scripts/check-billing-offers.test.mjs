import { describe, expect, it, vi } from 'vitest'
import { checkBillingOffers } from './check-billing-offers.mjs'

describe('deployment billing offers', () => {
  it('rejects public non-default offers on later pages when checkout is off', async () => {
    const getPlanList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ isDefault: true, publiclyVisible: true }],
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        data: [{ isDefault: false, publiclyVisible: true }],
        totalCount: 2,
      })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, false),
    ).rejects.toThrow('Checkout is disabled')
    expect(getPlanList).toHaveBeenLastCalledWith({
      payerType: 'user',
      limit: 100,
      offset: 1,
    })
  })

  it('allows private plans and the free default without mutating subscriptions', async () => {
    const getPlanList = vi.fn().mockResolvedValue({
      data: [
        { isDefault: true, publiclyVisible: true },
        { isDefault: false, publiclyVisible: false },
      ],
      totalCount: 2,
    })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, false),
    ).resolves.toBeUndefined()
  })

  it('allows public offers when checkout is enabled', async () => {
    const getPlanList = vi.fn().mockResolvedValue({
      data: [{ isDefault: false, publiclyVisible: true }],
      totalCount: 1,
    })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, true),
    ).resolves.toBeUndefined()
  })

  it('fails closed when Clerk cannot list plans', async () => {
    const getPlanList = vi.fn().mockRejectedValue(new Error('Unavailable'))
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, false),
    ).rejects.toThrow()
  })
})
