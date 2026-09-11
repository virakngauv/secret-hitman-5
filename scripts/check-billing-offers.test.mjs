import { describe, expect, it, vi } from 'vitest'
import {
  billingOfferFailureMessage,
  checkBillingOffers,
} from './check-billing-offers.mjs'

describe('deployment billing offers', () => {
  it('rejects an incomplete listing when a later page is empty', async () => {
    const getPlanList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ isDefault: true, publiclyVisible: true }],
        totalCount: 5,
      })
      .mockResolvedValue({ data: [], totalCount: 5 })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, false),
    ).rejects.toThrow('Incomplete Clerk plan listing.')
    expect(getPlanList).toHaveBeenCalledTimes(2)
    expect(getPlanList).toHaveBeenLastCalledWith({
      payerType: 'user',
      limit: 100,
      offset: 1,
    })
  })

  it('rejects checkout verification without required pack features', async () => {
    const getPlanList = vi.fn().mockResolvedValue({
      data: [{ isDefault: false, publiclyVisible: true, features: [] }],
      totalCount: 1,
    })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, true, []),
    ).rejects.toThrow(
      'No premium pack Features were supplied for launch verification.',
    )
  })

  it('reports known missing-feature validation details but hides provider errors', async () => {
    const getPlanList = vi.fn().mockResolvedValue({
      data: [{ isDefault: false, publiclyVisible: true, features: [] }],
      totalCount: 1,
    })
    const validation = await checkBillingOffers(
      { billing: { getPlanList } },
      true,
      ['pack_movies_v1'],
    ).catch((error) => error)
    expect(billingOfferFailureMessage(validation)).toBe(
      'Public Clerk user Plans are missing required pack Features: pack_movies_v1.',
    )
    const providerError = new Error('provider-secret-value')
    getPlanList.mockRejectedValue(providerError)
    const failure = await checkBillingOffers(
      { billing: { getPlanList } },
      true,
      ['pack_movies_v1'],
    ).catch((error) => error)
    expect(billingOfferFailureMessage(failure)).toContain(
      'Cannot verify Clerk user offers.',
    )
    expect(billingOfferFailureMessage(failure)).not.toContain(
      'provider-secret-value',
    )
    expect(
      billingOfferFailureMessage({
        message: 'provider-secret-value',
        name: 'BillingOfferValidationError',
      }),
    ).not.toContain('provider-secret-value')
  })
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
      data: [
        {
          isDefault: false,
          publiclyVisible: true,
          features: [{ slug: 'pack_movies_v1' }],
        },
      ],
      totalCount: 1,
    })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, true, [
        'pack_movies_v1',
      ]),
    ).resolves.toBeUndefined()
  })

  it('fails closed when Clerk cannot list plans', async () => {
    const getPlanList = vi.fn().mockRejectedValue(new Error('Unavailable'))
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, false),
    ).rejects.toThrow()
  })

  it.each(
    [
      [],
      [
        {
          isDefault: true,
          publiclyVisible: true,
          features: [{ slug: 'pack_movies_v1' }],
        },
      ],
      [
        {
          isDefault: false,
          publiclyVisible: false,
          features: [{ slug: 'pack_movies_v1' }],
        },
      ],
      [{ isDefault: false, publiclyVisible: true, features: [] }],
      [
        {
          isDefault: false,
          publiclyVisible: true,
          features: [{ slug: 'wrong_feature' }],
        },
      ],
    ].map((plans) => [plans]),
  )(
    'rejects missing public offers or required mappings (%j)',
    async (plans) => {
      const getPlanList = vi
        .fn()
        .mockResolvedValue({ data: plans, totalCount: plans.length })
      await expect(
        checkBillingOffers({ billing: { getPlanList } }, true, [
          'pack_movies_v1',
        ]),
      ).rejects.toThrow()
    },
  )

  it('collects feature coverage across all pages and rejects partial coverage', async () => {
    const getPlanList = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            isDefault: false,
            publiclyVisible: true,
            features: [{ slug: 'pack_movies_v1' }],
          },
        ],
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        data: [
          {
            isDefault: false,
            publiclyVisible: true,
            features: [{ slug: 'pack_travel_v1' }],
          },
        ],
        totalCount: 2,
      })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, true, [
        'pack_movies_v1',
        'pack_travel_v1',
      ]),
    ).resolves.toBeUndefined()
    getPlanList.mockResolvedValue({
      data: [
        {
          isDefault: false,
          publiclyVisible: true,
          features: [{ slug: 'pack_movies_v1' }],
        },
      ],
      totalCount: 1,
    })
    await expect(
      checkBillingOffers({ billing: { getPlanList } }, true, [
        'pack_movies_v1',
        'pack_travel_v1',
      ]),
    ).rejects.toThrow('pack_travel_v1')
  })
})
