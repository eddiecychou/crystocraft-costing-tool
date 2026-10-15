// Firebase boundary fixture: exercises the real approval transaction and UI.
export const fixtureSource = `
export const db = {};
export const authHeader = async () => ({});
const records = new Map([
 ['products/new-mcp-id', {name:'New product', marketing_description:''}],
 ['products/compliant', {name:'Compliant product', marketing_description:'Existing valid copy'}],
 ['products/awaiting', {name:'Awaiting product', marketing_description:''}],
 ['products/failed', {name:'Failed product', marketing_description:''}],
 ['products/stale', {name:'Changed product', marketing_description:'Externally changed'}]
]);
let listeners = [];
export const doc = (_db, ...parts) => parts.join('/');
export const collection = (_db, path) => path;
function snap(path) { return {exists: () => records.has(path), data: () => records.get(path)} }
function list() { return {docs:[...records].filter(([key]) => key.startsWith('products/')).map(([key,value]) => ({id:key.split('/')[1],data:()=>value}))} }
function emit() { listeners.forEach(fn=>fn(list())) }
export const getDocFromServer = async path => snap(path);
export const getDocsFromServer = async () => list();
export const onSnapshot = (_ref, next) => {listeners.push(next);next(list());return ()=>{listeners=listeners.filter(fn=>fn!==next)}};
export const serverTimestamp = () => 'SERVER_TIMESTAMP';
export async function runTransaction(_db, fn) {
 const writes=[];
 await fn({get:async path=>snap(path),set:(path,data)=>writes.push([path,data]),update:(path,data)=>writes.push([path,{...records.get(path),...data}])});
 writes.forEach(([path,data])=>records.set(path,data));emit();
}
export function addFixtureProduct() { records.set('products/added-later',{name:'Added while open',marketing_description:''});emit() }
export function fixtureRecords() {return [...records]}
`;
