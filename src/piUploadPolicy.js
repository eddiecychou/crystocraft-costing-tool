// Shared by PI selection, original-file hashing and server preparation.
// Keep the shipping_pi_originals Storage create rule at the same byte limit.
export const PI_MAX_FILE_BYTES = 20 * 1024 * 1024
export const PI_FILE_SIZE_HINT = '20 MB maximum per file'

export function assertPiUploadSize(file) {
  if (file?.size > PI_MAX_FILE_BYTES) {
    const error = new Error('This PI exceeds the 20 MB limit. Select a smaller PDF or image.')
    error.code = 'pi-file-too-large'
    throw error
  }
}
