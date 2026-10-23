import { friendlyError } from '../errors';

const t = ((key: string) => key) as never;
const failure = (status: number, code: string) => ({ response: { status, data: { error: { code } } } });

describe('friendlyError for the several-apps-one-server errors', () => {
  it('says why this app cannot be used instead of a generic sign-in failure', () => {
    expect(friendlyError(failure(403, 'WRONG_BRAND_APP'), t, 'login')).toBe('errors.wrongBrandApp');
    expect(friendlyError(failure(403, 'BRAND_DISABLED'), t, 'load')).toBe('errors.brandDisabled');
    expect(friendlyError(failure(404, 'BRAND_UNKNOWN'), t, 'load')).toBe('errors.brandUnknown');
  });

  it('a plain 403 at sign-in is still "account stopped"', () => {
    expect(friendlyError({ response: { status: 403, data: {} } }, t, 'login')).toBe('errors.suspended');
  });
});
