// Crop + rotate helpers for the manual image editor. The geometry helpers are
// pure and exported for headless testing; getCroppedCanvas needs a DOM canvas.

export function getRadianAngle(degreeValue) {
  return (degreeValue * Math.PI) / 180
}

// Bounding box of an (w×h) rectangle rotated by `rotation` degrees.
export function rotateSize(width, height, rotation) {
  const rad = getRadianAngle(rotation)
  return {
    width:  Math.abs(Math.cos(rad) * width)  + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width)  + Math.abs(Math.cos(rad) * height),
  }
}

// Produce a canvas containing the cropped (and rotated) region of `image`.
// `pixelCrop` = { x, y, width, height } in the ROTATED image's pixel space,
// exactly as react-easy-crop reports it. Returns an HTMLCanvasElement.
export function getCroppedCanvas(image, pixelCrop, rotation = 0) {
  const iw = image.naturalWidth || image.width
  const ih = image.naturalHeight || image.height

  // 1. Draw the (rotated) image onto a bounding-box canvas.
  const bbox = rotateSize(iw, ih, rotation)
  const rotated = document.createElement('canvas')
  rotated.width = Math.round(bbox.width)
  rotated.height = Math.round(bbox.height)
  const rctx = rotated.getContext('2d')
  rctx.translate(rotated.width / 2, rotated.height / 2)
  rctx.rotate(getRadianAngle(rotation))
  rctx.translate(-iw / 2, -ih / 2)
  rctx.drawImage(image, 0, 0)

  // 2. Copy just the crop rectangle into an output canvas.
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(pixelCrop.width))
  out.height = Math.max(1, Math.round(pixelCrop.height))
  out.getContext('2d').drawImage(
    rotated,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, out.width, out.height,
  )
  return out
}

// Aspect-ratio presets for the crop UI. `value: undefined` = original ratio.
export const ASPECTS = [
  { key: 'square', label: 'Square', value: 1 },
  { key: '4:3',    label: '4:3',    value: 4 / 3 },
  { key: '3:4',    label: '3:4',    value: 3 / 4 },
  { key: '16:9',   label: '16:9',   value: 16 / 9 },
  { key: 'orig',   label: 'Original', value: undefined },
]
