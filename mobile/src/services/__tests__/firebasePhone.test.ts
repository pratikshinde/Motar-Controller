import { firebaseProblem, startPhoneSignIn } from '../firebasePhone';

const mockGetIdToken = jest.fn();
const mockSignOut = jest.fn();
const mockConfirm = jest.fn();
const mockSignInWithPhoneNumber = jest.fn();
const mockAuth: { currentUser: { phoneNumber?: string; getIdToken: typeof mockGetIdToken } | null } = { currentUser: null };

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => mockAuth,
  signInWithPhoneNumber: (...args: unknown[]) => mockSignInWithPhoneNumber(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = null;
  mockSignOut.mockResolvedValue(undefined);
  mockSignInWithPhoneNumber.mockResolvedValue({ confirm: mockConfirm });
});

describe('startPhoneSignIn', () => {
  it('asks Firebase to text the number, then trades the typed code for an ID token and signs Firebase out again', async () => {
    mockGetIdToken.mockResolvedValue('id-token-abc');
    mockConfirm.mockResolvedValue({ user: { getIdToken: mockGetIdToken } });
    const challenge = await startPhoneSignIn('+919606595604');
    expect(mockSignInWithPhoneNumber).toHaveBeenCalledWith(mockAuth, '+919606595604');
    await expect(challenge.confirm('123456')).resolves.toBe('id-token-abc');
    expect(mockConfirm).toHaveBeenCalledWith('123456');
    expect(mockGetIdToken).toHaveBeenCalledWith(true);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('uses the account Android already signed in when it read the SMS by itself', async () => {
    mockGetIdToken.mockResolvedValue('auto-token');
    mockConfirm.mockRejectedValue(Object.assign(new Error('expired'), { code: 'auth/session-expired' }));
    mockAuth.currentUser = { phoneNumber: '+919606595604', getIdToken: mockGetIdToken };
    const challenge = await startPhoneSignIn('+919606595604');
    await expect(challenge.confirm('123456')).resolves.toBe('auto-token');
  });

  it('passes a wrong code on as an error instead of signing anyone in', async () => {
    mockConfirm.mockRejectedValue(Object.assign(new Error('wrong'), { code: 'auth/invalid-verification-code' }));
    const challenge = await startPhoneSignIn('+919606595604');
    await expect(challenge.confirm('000000')).rejects.toMatchObject({ code: 'auth/invalid-verification-code' });
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('firebaseProblem', () => {
  it.each([
    ['auth/invalid-verification-code', 'wrongCode'],
    ['auth/code-expired', 'wrongCode'],
    ['auth/session-expired', 'wrongCode'],
    ['auth/too-many-requests', 'tooMany'],
    ['auth/quota-exceeded', 'tooMany'],
    ['auth/invalid-phone-number', 'badPhone'],
    ['auth/network-request-failed', 'network'],
    ['auth/something-else', 'other'],
  ])('%s is %s', (code, expected) => {
    expect(firebaseProblem({ code })).toBe(expected);
  });

  it('is "other" for anything that is not a Firebase error', () => {
    expect(firebaseProblem(new Error('boom'))).toBe('other');
    expect(firebaseProblem(null)).toBe('other');
  });
});
