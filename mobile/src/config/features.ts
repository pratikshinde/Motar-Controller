/**
 * Switches for features that are built but not ready to offer.
 *
 * phoneSignInEnabled: "Already registered? Use your mobile number" on the Ajanta sign-in screen (Firebase / SMS code). It stays off
 * until the OTP route is decided and paid for (Firebase allows only 10 real SMS a day on a free project; MSG91 needs DLT approval).
 * Until then a farmer's only way in is the QR code from the dealer; a farmer on a new phone asks the dealer for a new QR.
 */
export const phoneSignInEnabled = false;
