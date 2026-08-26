import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { JoinRoomForm } from './join-room-form'

const mocks = vi.hoisted(() => ({
  connectionStatus: 'connected' as 'connecting' | 'connected' | 'disconnected',
  joinRoom: vi.fn(),
  onJoined: vi.fn(),
}))

vi.mock('@/components/game-socket-provider', () => ({
  useGameSocket: () => ({
    joinRoom: mocks.joinRoom,
    connectionStatus: mocks.connectionStatus,
  }),
}))

type JoinRoomFormProps = ComponentProps<typeof JoinRoomForm>

function renderForm(props: JoinRoomFormProps = {}) {
  const view = render(<JoinRoomForm {...props} />)

  return {
    ...view,
    rerenderForm(nextProps: JoinRoomFormProps = {}) {
      view.rerender(<JoinRoomForm {...nextProps} />)
    },
  }
}

describe('JoinRoomForm', () => {
  beforeEach(() => {
    mocks.connectionStatus = 'connected'
    mocks.joinRoom.mockReset()
    mocks.joinRoom.mockResolvedValue({ status: 'success', roomCode: 'frvg7' })
    mocks.onJoined.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('locks a room code supplied by the room route', () => {
    renderForm({ roomCode: 'frvg7' })

    expect(screen.getByLabelText('Room code')).toHaveValue('frvg7')
    expect(screen.getByLabelText('Room code')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Room code')).not.toHaveAttribute(
      'placeholder',
    )
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('keeps the room code editable in the standard join flow', () => {
    renderForm()

    expect(screen.getByLabelText('Room code')).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText('Room code')).not.toHaveAttribute(
      'placeholder',
    )
    expect(screen.getByLabelText('Room code')).toHaveFocus()
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'placeholder',
      'Your name',
    )
  })

  it('keeps focus stable across connection status transitions', () => {
    mocks.connectionStatus = 'connecting'
    const { rerenderForm } = renderForm()

    expect(screen.getByLabelText('Room code')).toHaveFocus()

    mocks.connectionStatus = 'connected'
    rerenderForm()

    expect(screen.getByLabelText('Room code')).toHaveFocus()
  })

  it('waits for the game socket before allowing a join', () => {
    mocks.connectionStatus = 'connecting'
    renderForm()

    expect(screen.getByLabelText('Room code')).toBeEnabled()
    expect(screen.getByLabelText('Name')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Connecting to the game server…',
    )
  })

  it('invokes onJoined with the room after a successful join', async () => {
    const user = userEvent.setup()

    renderForm({ roomCode: 'frvg7', onJoined: mocks.onJoined })

    await user.type(screen.getByLabelText('Name'), 'Browser player')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => {
      expect(mocks.joinRoom).toHaveBeenCalledWith('frvg7', 'Browser player')
    })
    expect(mocks.onJoined).toHaveBeenCalledWith({ roomCode: 'frvg7' })
  })

  it('leaves the parent in charge when onJoined is omitted', async () => {
    const user = userEvent.setup()

    renderForm({ roomCode: 'frvg7' })

    await user.type(screen.getByLabelText('Name'), 'Browser player')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => {
      expect(mocks.joinRoom).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
    })
  })

  it('shows when the room has no available seats', async () => {
    const user = userEvent.setup()
    mocks.joinRoom.mockResolvedValue({
      status: 'room_full',
      message: 'This room is full.',
    })

    renderForm({ roomCode: 'frvg7', onJoined: mocks.onJoined })

    await user.type(screen.getByLabelText('Name'), 'Late player')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This room is full.',
    )
    expect(mocks.onJoined).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
  })

  it('shows when a game has already started', async () => {
    const user = userEvent.setup()
    mocks.joinRoom.mockResolvedValue({
      status: 'game_in_progress',
      message: 'This game has already started.',
    })

    renderForm({ roomCode: 'frvg7', onJoined: mocks.onJoined })

    await user.type(screen.getByLabelText('Name'), 'Late player')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This game has already started.',
    )
    expect(mocks.onJoined).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
  })

  it('shows when the host removed the local player from the room', async () => {
    const user = userEvent.setup()
    mocks.joinRoom.mockResolvedValue({
      status: 'removed_from_room',
      message: 'The host removed you from this room. You can’t rejoin it.',
    })

    renderForm({ roomCode: 'frvg7', onJoined: mocks.onJoined })

    await user.type(screen.getByLabelText('Name'), 'Grace II')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The host removed you from this room. You can’t rejoin it.',
    )
    expect(mocks.onJoined).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
  })
})
