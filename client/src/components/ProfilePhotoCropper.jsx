import { useRef, useState } from 'react'
import { Check, Move, X } from 'lucide-react'

const OUTPUT_SIZE = 512

function ProfilePhotoCropper({ source, saving, onCancel, onSave }) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [frameSize, setFrameSize] = useState(0)
  const [error, setError] = useState('')
  const dragRef = useRef(null)
  const cropSize = frameSize || 320
  const baseScale = imageSize.width && imageSize.height
    ? Math.min(cropSize / imageSize.width, cropSize / imageSize.height)
    : 1

  const displayedWidth = imageSize.width * baseScale * zoom
  const displayedHeight = imageSize.height * baseScale * zoom

  const clampOffset = (next, nextZoom = zoom) => {
    const scaledWidth = imageSize.width * baseScale * nextZoom
    const scaledHeight = imageSize.height * baseScale * nextZoom
    const maxX = Math.max(0, (scaledWidth - cropSize) / 2)
    const maxY = Math.max(0, (scaledHeight - cropSize) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) }
  }

  const changeZoom = (value) => {
    const nextZoom = Number(value)
    setZoom(nextZoom)
    setOffset((current) => clampOffset(current, nextZoom))
  }

  const beginDrag = (event) => {
    if (saving) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const moveDrag = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y }
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY }
    setOffset((current) => clampOffset({ x: current.x + delta.x, y: current.y + delta.y }))
  }

  const endDrag = () => { dragRef.current = null }

  const saveCrop = async () => {
      setError('')
    try {
      const image = new Image()
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('This image could not be cropped. Choose another photo.'))
        image.src = source
      })
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Your phone could not prepare this photo. Try another image.')
      const outputScale = canvas.width / cropSize
      const outputWidth = displayedWidth * outputScale
      const outputHeight = displayedHeight * outputScale
      context.fillStyle = '#111827'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(
        image,
        (canvas.width - outputWidth) / 2 + offset.x * outputScale,
        (canvas.height - outputHeight) / 2 + offset.y * outputScale,
        outputWidth,
        outputHeight,
      )
      await onSave(canvas.toDataURL('image/jpeg', 0.88))
    } catch (cropError) {
      setError(cropError.message || 'Unable to save this photo.')
    }
  }

  return (
    <div className="profile-crop-backdrop" role="presentation">
      <section className="profile-crop-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title">
        <header className="profile-crop-heading">
          <div><span className="explore-eyebrow">PROFILE PHOTO</span><h2 id="profile-crop-title">Adjust your photo</h2></div>
          <button type="button" className="profile-crop-close" aria-label="Cancel photo edit" onClick={onCancel} disabled={saving}><X size={20} /></button>
        </header>
        <p className="profile-crop-copy">The full photo is shown first. Zoom in and drag to choose what appears in the square profile frame.</p>
        <div
          className="profile-crop-frame"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label="Drag to position your profile photo"
        >
          <img
            src={source}
            alt=""
            draggable="false"
            onLoad={(event) => {
              const frame = event.currentTarget.parentElement
              setFrameSize(frame?.clientWidth || 320)
              setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              setZoom(1)
              setOffset({ x: 0, y: 0 })
            }}
            style={{
              width: `${displayedWidth}px`,
              height: `${displayedHeight}px`,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
          <span className="profile-crop-grid profile-crop-grid-vertical" aria-hidden="true" />
          <span className="profile-crop-grid profile-crop-grid-horizontal" aria-hidden="true" />
          <span className="profile-crop-frame-hint"><Move size={15} /> Drag to position</span>
        </div>
        <label className="profile-crop-zoom" htmlFor="profile-crop-zoom"><span>Zoom</span><input id="profile-crop-zoom" type="range" min="1" max="3" step="0.02" value={zoom} onChange={(event) => changeZoom(event.target.value)} disabled={saving} /></label>
        <button type="button" className="profile-crop-fit" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }} disabled={saving || zoom === 1}>Show full photo</button>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="profile-crop-actions">
          <button type="button" className="profile-edit-pill" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="setup-submit" onClick={() => { void saveCrop() }} disabled={saving || !imageSize.width}>{saving ? 'Saving…' : <>Use this photo <Check size={17} /></>}</button>
        </div>
      </section>
    </div>
  )
}

export default ProfilePhotoCropper
