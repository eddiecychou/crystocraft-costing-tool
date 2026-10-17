import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initAdminApp } from './lib/firebaseAdmin.js'
import { createProductImagesHandler } from './lib/productImages.js'

export default req => createProductImagesHandler({
  enabled:process.env.OC_PRODUCT_IMAGES_ENABLED==='true',
  accessToken:process.env.OC_PRODUCT_IMAGES_TOKEN,
  signingSecret:process.env.OC_PRODUCT_IMAGES_SIGNING_SECRET,
  bucketName:process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  baseUrl:process.env.OC_PRODUCT_IMAGES_BASE_URL || 'https://portal.crystocraft.com',
  context:async()=>{initAdminApp();const name=process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;return {db:getFirestore(),bucket:getStorage().bucket(name)}},
})(req)
export const config={path:['/api/oc/product-images','/api/oc/product-image'],rateLimit:{windowSize:60,windowLimit:60,aggregateBy:['ip','domain']}}
