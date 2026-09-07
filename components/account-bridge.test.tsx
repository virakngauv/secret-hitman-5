import { fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountBridge, AccountControl, useAccount } from './account-bridge'
const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  auth: {
    isLoaded: true,
    userId: 'user_one' as string | undefined,
    getToken: vi.fn(),
  },
}))
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => mocks.auth,
  useClerk: () => ({ signOut: mocks.signOut }),
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: Object.assign(
    ({ children }: { children?: React.ReactNode }) => (
      <>
        <span>Profile</span>
        {children}
      </>
    ),
    {
      MenuItems: ({ children }: { children: React.ReactNode }) => children,
      Action: ({ label, onClick }: { label: string; onClick: () => void }) => (
        <button onClick={onClick}>{label}</button>
      ),
    },
  ),
}))
afterEach(() => {
  mocks.auth.userId = 'user_one'
  vi.clearAllMocks()
})
it('has a safe no-provider fallback', () => {
  render(<AccountControl />)
  expect(screen.getByText('Account features unavailable')).toBeVisible()
})
it('opens account management separately when preserving a room', () => {
  render(
    <AccountBridge>
      <AccountControl preserveRoom />
    </AccountBridge>,
  )
  const link = screen.getByRole('link', { name: 'Account & Billing' })
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})
it('offers signup and login, then account controls after authentication', () => {
  mocks.auth.userId = undefined
  const view = render(
    <AccountBridge>
      <AccountControl />
    </AccountBridge>,
  )
  expect(screen.getByRole('button', { name: 'Log in' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign up' })).toBeVisible()
  mocks.auth.userId = 'user_one'
  view.rerender(
    <AccountBridge>
      <AccountControl />
    </AccountBridge>,
  )
  expect(
    screen.getByRole('link', { name: 'Account & Billing' }),
  ).toHaveAttribute('href', '/account')
  expect(screen.getByText('Profile')).toBeVisible()
})
it('does not return a token retrieved for an account that changed mid-request', async () => {
  let complete!: (token: string) => void
  mocks.auth.getToken.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve
    }),
  )
  const onResult = vi.fn()
  function Consumer() {
    const account = useAccount()
    return (
      <button
        onClick={() =>
          void account.getToken().then(onResult, () => onResult('changed'))
        }
      >
        Get token
      </button>
    )
  }
  const view = render(
    <AccountBridge>
      <Consumer />
    </AccountBridge>,
  )
  fireEvent.click(screen.getByRole('button'))
  mocks.auth.userId = 'user_two'
  view.rerender(
    <AccountBridge>
      <Consumer />
    </AccountBridge>,
  )
  await act(async () => complete('old-token'))
  expect(onResult).toHaveBeenCalledWith('changed')
  expect(mocks.auth.getToken).toHaveBeenCalledWith({ skipCache: true })
})

it('ends the lobby account session with a callback instead of redirecting', async () => {
  mocks.signOut.mockImplementation(async (callback: () => void) => callback())
  render(
    <AccountBridge>
      <AccountControl preserveRoom />
    </AccountBridge>,
  )
  await act(async () =>
    fireEvent.click(screen.getByText('Sign out and stay in room')),
  )
  expect(mocks.signOut).toHaveBeenCalledWith(expect.any(Function))
  expect(screen.getByRole('link', { name: 'Account & Billing' })).toBeVisible()
})
it('reports sign-out failure and allows a retry', async () => {
  mocks.signOut
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined)
  render(
    <AccountBridge>
      <AccountControl preserveRoom />
    </AccountBridge>,
  )
  await act(async () =>
    fireEvent.click(screen.getByText('Sign out and stay in room')),
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Could not sign out')
  await act(async () =>
    fireEvent.click(screen.getByText('Sign out and stay in room')),
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
