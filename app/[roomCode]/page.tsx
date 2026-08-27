import type { Metadata } from 'next'

import { RoomLobby } from '@/components/room-lobby'

export const metadata: Metadata = {
  title: 'Room — Secret Hitman',
}

export default async function RoomLobbyPage({
  params,
}: {
  params: Promise<{ roomCode: string }>
}) {
  const { roomCode } = await params

  return <RoomLobby roomCode={roomCode.trim().toLowerCase()} />
}
