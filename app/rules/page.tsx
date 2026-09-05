import type { Metadata } from 'next'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Rules | Secret Hitman',
  description:
    'Learn how to play Secret Hitman and how each guess affects the score.',
}

export default function RulesPage() {
  return (
    <main className="min-h-screen px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="page-title">Rules</h1>
        </header>

        <div className="space-y-5 text-base leading-7">
          <section className="game-panel" aria-labelledby="how-a-round-plays">
            <h2 id="how-a-round-plays" className="mb-3 text-2xl font-black">
              How to play
            </h2>
            <div className="space-y-4">
              <p>
                Play with 2 to 12 players. Everyone writes a hint before
                guessing begins.
              </p>
              <p>
                Each player gets a private board of 12 words. Three civilians
                and one assassin are locked. Choose 1 to 5 of the other eight as
                targets, then share one word or phrase. Any words you leave
                unselected stay civilians.
              </p>
              <p>
                Enter your hint and select &quot;Submit&quot;. The app shows the
                number of targets you chose next to your hint. Select two
                targets and enter &quot;ORBIT&quot;, and the app shows
                &quot;ORBIT 2&quot;. You do not need to type the number.
              </p>
              <p>
                Once everyone has submitted, the host starts guessing. Play
                through one board at a time. You do not guess on your own board.
                The other players see its words and your hint with its target
                count. The word roles start hidden from players who are
                guessing.
              </p>
              <p>
                Players guess at the same time. Tap an unclaimed word to claim
                it. Each word can be claimed once, so another player may get
                there first.
              </p>
            </div>
          </section>

          <section className="game-panel" aria-labelledby="scoring">
            <h2 id="scoring" className="mb-3 text-2xl font-black">
              Tile points
            </h2>
            <p className="mb-4">
              Each claimed word changes both the guesser&apos;s score and the
              hint writer&apos;s score by the amount below.
            </p>
            <table className="rules-role-table" aria-label="Tile points">
              <thead>
                <tr>
                  <th scope="col">Word</th>
                  <th scope="col">Points</th>
                  <th scope="col">What happens</th>
                </tr>
              </thead>
              <tbody>
                <tr className="rules-role-row-target">
                  <th scope="row">Target</th>
                  <td data-label="Points">
                    <strong>+3 each</strong>
                  </td>
                  <td data-label="What happens">
                    Keep guessing while targets remain.
                  </td>
                </tr>
                <tr className="rules-role-row-civilian">
                  <th scope="row">Civilian</th>
                  <td data-label="Points">
                    <strong>−1 each</strong>
                  </td>
                  <td data-label="What happens">
                    You cannot guess again on this board.
                  </td>
                </tr>
                <tr className="rules-role-row-assassin">
                  <th scope="row">Assassin</th>
                  <td data-label="Points">
                    <strong>−5 each</strong>
                  </td>
                  <td data-label="What happens">
                    Guessing ends for everyone on this board.
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="mt-4 space-y-4">
              <p>
                The board also ends for everyone when all targets have been
                claimed.
              </p>
              <p>
                While you are still guessing, select &quot;I&apos;m done
                guessing&quot; to stop on that board. Stopping does not change
                your score.
              </p>
              <p>
                Scores can go below zero and carry across boards in the same
                game. The highest score in the final standings wins. Players
                tied for the highest score share first place.
              </p>
            </div>
          </section>

          <section className="game-panel" aria-labelledby="hint-tips">
            <h2 id="hint-tips" className="mb-3 text-2xl font-black">
              Hint writing tips
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Use a word or phrase that connects your targets. Names such as
                &quot;Percy Jackson&quot; or &quot;New York City&quot; are fine.
                Keep your hint within the 40-character limit.
              </li>
              <li>
                Try to connect your targets with one clear idea. Check the hint
                against the civilians and the assassin, too. If it points at the
                wrong word, change the hint or choose fewer targets.
              </li>
              <li>
                One target is allowed. Choose more only when the connection is
                clear. You score for targets that players claim, not targets you
                select.
              </li>
            </ul>
          </section>

          <section className="game-panel" aria-labelledby="host-controls">
            <h2 id="host-controls" className="mb-3 text-2xl font-black">
              Host controls
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Create a room, share its code or invite link, and start the game
                from the lobby. Once everyone has submitted a hint, select
                &quot;Start game&quot; to begin guessing.
              </li>
              <li>
                Select &quot;Next hint&quot; to move to the next board. On the
                final board, select &quot;View scoreboard&quot;. The app asks
                for confirmation if anyone is still guessing when you move on.
              </li>
              <li>
                During hint writing, the host can reject another player&apos;s
                submitted hint. That player gets a new board and writes again.
                Use &quot;Edit&quot; to revise your own submitted hint before
                guessing starts.
              </li>
              <li>
                The host can remove another player. During hint writing, this
                removes that player&apos;s board and hint. If fewer than two
                players would remain, confirming the removal ends the round and
                returns everyone to the lobby.
              </li>
              <li>
                During guessing, removing a player keeps the picks and scoring
                changes already made but removes that player from the standings.
                Their board is skipped if its turn has not started. A removed
                player cannot rejoin the room.
              </li>
              <li>
                If the host leaves, the remaining active player who joined first
                becomes host. If only spectators remain, the active spectator
                who joined first becomes host.
              </li>
            </ul>
          </section>
        </div>

        <div className="rules-back-dock">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
