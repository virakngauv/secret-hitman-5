import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HomePage from './page'

describe('HomePage', () => {
  it('shows the combined call to action with both room flows', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { name: 'Secret Hitman' })).toBeVisible()
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /12 words|1 assassin|build a clue|choose your entry/i,
    )
    expect(screen.getByText('A social word game')).toBeVisible()
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /\b(?:timers?|rounds?)\b/i,
    )
    expect(screen.queryByText('Play together')).not.toBeInTheDocument()
    expect(screen.queryByText(/prototype/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a room' })).toHaveAttribute(
      'href',
      '/create',
    )
    expect(screen.getByRole('link', { name: 'Join a room' })).toHaveAttribute(
      'href',
      '/join',
    )
    expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'href',
      '/rules',
    )
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      ['Create a room', 'Join a room', 'Rules'],
    )
  })
})

afterEach(() => vi.unstubAllEnvs())
it.each(['false', 'true'])(
  'gates home purchase and account entry points with the release flag (%s)',
  (flag) => {
    vi.stubEnv('ENABLE_WORD_PACKS', flag)
    render(<HomePage />)
    if (flag === 'true')
      expect(
        screen.getByRole('button', { name: 'Buy word packs' }),
      ).toBeVisible()
    else {
      expect(
        screen.queryByRole('button', { name: 'Buy word packs' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/Account features|Sign in|Sign up/),
      ).not.toBeInTheDocument()
    }
  },
)
