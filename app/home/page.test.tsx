import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HomePage from './page'

describe('HomePage', () => {
  it('shows the combined call to action with both room flows', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { name: 'Secret Hitman' })).toBeVisible()
    expect(screen.getByText('12 WORDS')).toBeVisible()
    expect(screen.getByText('0 TIMERS')).toBeVisible()
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
