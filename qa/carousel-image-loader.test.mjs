import test from 'node:test'
import assert from 'node:assert/strict'
import { createCarouselImageLoader, carouselImageSource, canWarmCarousel } from '../src/carouselImageLoader.js'
const url = name => `https://firebasestorage.googleapis.com/v0/b/demo/o/${name}.jpg`
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const images = []
  const load = createCarouselImageLoader(() => {
    const image = { naturalWidth: 100, decode: async () => {}, removeAttribute() {} }
    images.push(image)
    return image
  })
  return { load, images, finish: async image => { image.onload(); await tick() } }
}
test('prefetch uses the same responsive candidates and sizes as the visible image', () => {
  const source = carouselImageSource(url('photo'))
  assert.match(source.srcSet, /w=320.*320w.*w=640.*640w/)
  assert.equal(source.sizes, '(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw')
  assert.equal(carouselImageSource(url('photo'), true).srcSet, undefined)
})
test('data saver and slow connections suppress speculative warming', () => {
  assert.equal(canWarmCarousel({saveData:true}), false)
  assert.equal(canWarmCarousel({effectiveType:'2g'}), false)
  assert.equal(canWarmCarousel({effectiveType:'slow-2g'}), false)
  assert.equal(canWarmCarousel({effectiveType:'4g'}), true)
})
test('global speculative limit reserves slots for selected images, and queued clicks jump ahead', async () => {
  const f = fixture()
  const jobs = ['one','two','three','four'].map(name => f.load(url(name)))
  assert.equal(f.images.length, 2)
  const selected = f.load(url('four'), {urgent:true})
  assert.equal(f.images.length, 3)
  assert.match(f.images[2].src, /four/)
  assert.equal(f.images[2].fetchPriority, 'high')
  await f.finish(f.images[0]); await f.finish(f.images[1]); await f.finish(f.images[2])
  assert.equal(f.images.length, 4)
  await f.finish(f.images[3]); await Promise.all([...jobs, selected])
})
test('in-flight and decoded requests deduplicate and intent boosts in-flight priority', async () => {
  const f = fixture(), first=f.load(url('same'))
  assert.equal(f.load(url('same'),{urgent:true}), first)
  assert.equal(f.images.length, 1)
  assert.equal(f.images[0].fetchPriority, 'high')
  await f.finish(f.images[0]); assert.equal(await first, true)
  assert.equal(await f.load(url('same')), true)
  assert.equal(f.images.length, 1)
})
test('failure frees slots and allows an explicit retry or original fallback', async () => {
  const f = fixture(), first=f.load(url('bad'))
  f.images[0].onerror()
  assert.equal(await first, false)
  const retry=f.load(url('bad'),{urgent:true,original:true})
  assert.equal(f.images[1].src, url('bad'))
  assert.equal(f.images[1].srcset, undefined)
  await f.finish(f.images[1]); assert.equal(await retry,true)
})
test('request resolves only after image decode finishes', async () => {
  const f=fixture();let decoded,settled=false
  const pending=f.load(url('decode')).then(()=>{settled=true})
  f.images[0].decode=()=>new Promise(resolve=>{decoded=resolve})
  f.images[0].onload();await tick();assert.equal(settled,false)
  decoded();await pending;assert.equal(settled,true)
})
test('a stalled request times out, releases capacity and permits retry', async () => {
  let created=0
  const load=createCarouselImageLoader(()=>{created++;return {removeAttribute(){}}},10)
  assert.equal(await load(url('stalled')),false)
  assert.equal(await load(url('stalled'),{urgent:true}),false)
  assert.equal(created,2)
})
