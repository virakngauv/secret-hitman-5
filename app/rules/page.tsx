import type { Metadata } from 'next'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Rules — Secret Hitman',
  description:
    'The quick version of Secret Hitman: write a hint, race to find its targets, and dodge the assassin.',
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
              How a round plays
            </h2>
            <ol className="space-y-4">
              <li>
                <strong>Write a hint.</strong> On your turn you get a secret
                board of 12 words — four are locked in advance as three
                civilians and an assassin. Choose 1–5 of the remaining eight as
                targets, then share one word plus that number — “ORBIT 2” means
                “I connected two of the words on this board.” Keep your choices
                to yourself.
              </li>
              <li>
                <strong>Race to pick.</strong> Everyone else sees only your word
                and number, then taps words on your board. Hit a target and you
                can keep going. Every word has one owner, so beat the other
                pickers to the good ones.
              </li>
              <li>
                <strong>
                  Dodge the civilians and especially the assassin.
                </strong>{' '}
                Most words on the board are civilians — pick one and the board
                ends for just you. The assassin is worse: one touch ends the
                board on the spot for everyone.
              </li>
            </ol>
          </section>

          <section className="game-panel" aria-labelledby="scoring">
            <h2 id="scoring" className="mb-3 text-2xl font-black">
              Tile points
            </h2>
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
                  <td data-label="What happens">Keep going!</td>
                </tr>
                <tr className="rules-role-row-civilian">
                  <th scope="row">Civilian</th>
                  <td data-label="Points">
                    <strong>−1 each</strong>
                  </td>
                  <td data-label="What happens">The board ends for you.</td>
                </tr>
                <tr className="rules-role-row-assassin">
                  <th scope="row">Assassin</th>
                  <td data-label="Points">
                    <strong>−5 each</strong>
                  </td>
                  <td data-label="What happens">
                    The board ends for everyone.
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4">
              Picks always split evenly: you and the hint writer gain (or lose)
              the same points. You can stop anytime with{' '}
              <strong>I’m done guessing</strong>. Scores may dip below zero and
              carry over between hints. After the last board, the highest total
              wins — ties share the crown.
            </p>
          </section>

          <section className="game-panel" aria-labelledby="hint-tips">
            <h2 id="hint-tips" className="mb-3 text-2xl font-black">
              Hint writing tips
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Aim for two or more targets.</strong> Any found target
                scores, but multi-target hints are where the big rounds come
                from.
              </li>
              <li>
                <strong>One concept per hint.</strong> Multi-word hints are fine
                when they name a single thing — “Percy Jackson” and “New York
                City” count — but “cold enough to skate” doesn’t.
              </li>
              <li>
                <strong>Fit your targets and nothing else.</strong> The editable
                words you leave behind become civilians, so a hint that also
                matches them drags pickers into −1s.
              </li>
              <li>
                <strong>Mind the assassin.</strong> One wrong pick costs more
                than a target earns. If your hint could point anywhere near it,
                write a different hint.
              </li>
              <li>
                <strong>When in doubt, go small.</strong> One safe target beats
                three risky ones — you still bank the +3.
              </li>
            </ul>
          </section>

          <section className="game-panel" aria-labelledby="host-controls">
            <h2 id="host-controls" className="mb-3 text-2xl font-black">
              Host controls
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Run the flow.</strong> The host creates a room and
                shares its code or invite link, starts the game for 2–12
                players, selects <strong>Start game</strong> once every hint is
                in, and moves everyone along with <strong>Next hint</strong>{' '}
                until the last board. Advancing while someone is still picking
                asks for a quick confirmation.
              </li>
              <li>
                <strong>Reject hints.</strong> While players are still writing,
                the host can reject a submitted hint — that player gets a fresh
                board and writes again.
              </li>
              <li>
                <strong>Keep the room tidy.</strong> The host can remove a
                player. During hinting their board and hint are dropped —
                removing the only other player instead resets the round for
                everyone; during guessing their finished picks stand but their
                score is hidden from the standings.
              </li>
              <li>
                <strong>Hosts can change.</strong> If the host leaves, hosting
                passes to the player who joined earliest — or, if only
                spectators remain, the earliest of them.
              </li>
            </ul>
          </section>
        </div>

        <div className="rules-back-dock">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/home">Back to home</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
