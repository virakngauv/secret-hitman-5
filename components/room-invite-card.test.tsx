import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QRCodeSVG } from 'qrcode.react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RoomInviteActions,
  RoomInviteCard,
} from '@/components/room-invite-card'

describe('RoomInviteCard', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      ...window.location,
      origin: 'https://playtest.example',
    })
  })

  it('renders the room code and a QR code of the invite URL', async () => {
    render(<RoomInviteCard roomCode="frvg7" />)

    expect(screen.getByLabelText('Room code frvg7')).toHaveTextContent('frvg7')
    expect(
      await screen.findByRole('img', { name: 'Scan to join room frvg7' }),
    ).toBeInTheDocument()
  })

  it('encodes the canonical origin plus room code', async () => {
    const { container } = render(<RoomInviteCard roomCode="frvg7" />)
    await screen.findByRole('img', { name: 'Scan to join room frvg7' })
    const { container: reference } = render(
      <QRCodeSVG value="https://playtest.example/frvg7" />,
    )

    const path = container.querySelector('svg path')?.getAttribute('d')
    const expected = reference.querySelector('svg path')?.getAttribute('d')
    expect(path).toBe(expected)
  })

  it('encodes a reserved-character room code as one path segment', async () => {
    render(<RoomInviteCard roomCode="a/b?c" />)

    const qr = await screen.findByRole('img', {
      name: 'Scan to join room a/b?c',
    })
    expect(qr).toHaveAttribute(
      'data-invite-url',
      'https://playtest.example/a%2Fb%3Fc',
    )
  })

  it('renders the QR code with phone-scannable sizing classes', async () => {
    render(<RoomInviteCard roomCode="frvg7" />)

    const qr = await screen.findByRole('img', {
      name: 'Scan to join room frvg7',
    })

    expect(qr).toHaveClass('size-48')
    expect(qr.parentElement).toHaveClass('p-2')
  })
})

describe('RoomInviteActions', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      ...window.location,
      origin: 'https://playtest.example',
    })
  })

  it('copies the invite link and announces success', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...window.navigator,
      clipboard: { writeText },
    })

    render(<RoomInviteActions roomCode="frvg7" />)
    const copyButton = await screen.findByRole('button', {
      name: 'Copy invite link',
    })
    await waitFor(() => expect(copyButton).toBeEnabled())

    await user.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('https://playtest.example/frvg7')
    expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Invite link copied: https://playtest.example/frvg7',
    )
  })

  it('falls back to showing the URL when copying fails', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', {
      ...window.navigator,
      clipboard: { writeText },
    })

    render(<RoomInviteActions roomCode="frvg7" />)
    const copyButton = await screen.findByRole('button', {
      name: 'Copy invite link',
    })
    await waitFor(() => expect(copyButton).toBeEnabled())

    await user.click(copyButton)

    expect(
      screen.getByRole('button', { name: 'Copy invite link' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Copy failed. Share this link instead: https://playtest.example/frvg7',
    )
  })
})
