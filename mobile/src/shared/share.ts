import { Platform, Share } from 'react-native';

/**
 * Hands a text file to the person: a browser download on web, the phone's share sheet on Android / iOS
 * (WhatsApp, Drive, email ...). Text only, so no file-system permission is needed.
 */
export async function shareTextFile(filename: string, text: string, mime = 'text/plain'): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ title: filename, message: text });
}
