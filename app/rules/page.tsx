import type { Metadata } from 'next'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Rules — Secret Hitman',
  description:
    'Learn how to write clues, find targets, avoid the assassin, and score in Secret Hitman.',
}

export default function RulesPage() {
  return (
    <main className="min-h-screen px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Button asChild variant="outline" className="mb-8">
          <Link href="/home">Back to home</Link>
        </Button>

        <header className="mb-8">
          <p className="page-eyebrow">Secret Hitman · Field guide</p>
          <h1 className="page-title">Rules</h1>
          <p className="page-subtitle">
            Write a clever clue. Race to find its targets. Avoid the assassin.
            Earn points as both a clue writer and a picker to finish with the
            highest score.
          </p>
        </header>

        <div className="space-y-5 text-base leading-7">
          <section className="game-panel" aria-labelledby="get-started">
            <h2 id="get-started" className="mb-3 text-2xl font-black">
              1. Gather your players
            </h2>
            <p>
              Create a room and share its code or invite link, or join a
              friend’s room. The host starts with 2–12 players. Everyone who
              starts gets a turn as clue writer; people joining after the game
              starts can watch as spectators.
            </p>
          </section>

          <section className="game-panel" aria-labelledby="write-clue">
            <h2 id="write-clue" className="mb-3 text-2xl font-black">
              2. Build and lock in your clue
            </h2>
            <p>
              You receive a private board of 12 words. Three civilians and the
              assassin are randomly locked: you cannot change their roles. The
              other eight words are editable. Select one to five of them as
              targets; every unselected non-assassin word becomes a civilian.
            </p>
            <p className="mt-3">
              Enter your hint and select <strong>Lock in hint</strong>. The
              number of targets you select becomes your hint’s number. For
              example, a hint of “Orbit” with the number 2 tells the other
              players to look for two connected targets. Keep your target
              choices and the assassin’s location secret.
            </p>
            <p className="mt-3">
              Once everyone has locked in a hint, the host selects{' '}
              <strong>Start guessing</strong>.
            </p>
          </section>

          <section className="game-panel" aria-labelledby="pick-pass">
            <h2 id="pick-pass" className="mb-3 text-2xl font-black">
              3. Pick targets or pass
            </h2>
            <p>
              Each turn shows one player’s hint, number, and word board. The
              clue writer can see the roles but does not guess on their own
              board. The other players pick from the same board, competing to
              claim targets first. Targets and civilians reveal when claimed and
              cannot be claimed again by another player.
            </p>
            <p className="mt-3">
              After finding a target, you can keep guessing. Picking a civilian
              or the assassin ends your guessing for that board. You can also
              pass by selecting <strong>I’m done guessing</strong> to stop
              without changing your score. Finding all targets ends guessing for
              everyone on that board.
            </p>
            <p className="mt-3">
              The first assassin hit ends the board for every picker and reveals
              every role and claimant to players and spectators. Later or
              in-flight picks cannot change that completed board.
            </p>
          </section>

          <section className="game-panel" aria-labelledby="scoring">
            <h2 id="scoring" className="mb-3 text-2xl font-black">
              4. Count the points
            </h2>
            <dl className="space-y-4">
              <div className="bg-background rounded-xl border p-4">
                <dt className="font-bold">Target · +2 each</dt>
                <dd>
                  The successful picker earns 2 points, and the clue writer
                  earns 2 points.
                </dd>
              </div>
              <div className="bg-background rounded-xl border p-4">
                <dt className="font-bold">Civilian · −1 each</dt>
                <dd>
                  The picker and clue writer each lose 1 point. Only that picker
                  stops guessing on this board.
                </dd>
              </div>
              <div className="bg-background rounded-xl border p-4">
                <dt className="font-bold">Assassin · −3 each</dt>
                <dd>
                  The first picker to find it and the clue writer each lose 3
                  points. The board ends and is revealed to everyone.
                </dd>
              </div>
            </dl>
            <p className="mt-4">
              Scores can go below zero. Points carry over between clues.
            </p>
          </section>

          <section className="game-panel" aria-labelledby="finish-game">
            <h2 id="finish-game" className="mb-3 text-2xl font-black">
              5. Finish the game
            </h2>
            <p>
              The host selects <strong>Next hint</strong> to move to the next
              clue writer. After the last clue, the host selects{' '}
              <strong>Finish the game</strong> to reveal the final board and
              standings. The highest total score wins; players tied for the
              highest score share the win.
            </p>
          </section>
        </div>

        <Button asChild variant="outline" className="mt-8 w-full sm:w-auto">
          <Link href="/home">Back to home</Link>
        </Button>
      </div>
    </main>
  )
}
