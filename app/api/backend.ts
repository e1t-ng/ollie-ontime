// Native PostgreSQL and password hashing run in Node, in the separate API service.
// API_BASE_URL points at it (on Railway: http://<api-service>.railway.internal:3001).
export async function forward(request:Request){
  const url=new URL(request.url);
  const configured=process.env.API_BASE_URL?.trim();
  const base=configured||(['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'http://127.0.0.1:3001':null);
  if(!base)return Response.json({error:'Configure API_BASE_URL for the OnTime Node backend.'},{status:503});
  const headers=new Headers();
  for(const name of ['cookie','content-type','origin','sec-fetch-site']){const value=request.headers.get(name);if(value)headers.set(name,value)}
  try{
    const response=await fetch(new URL(url.pathname+url.search,base),{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:await request.arrayBuffer()}:{})});
    // Vinext adds response headers; network responses have immutable headers.
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers:new Headers(response.headers)});
  }
  catch{return Response.json({error:'OnTime API is unavailable. Start it with npm run dev:api.'},{status:503})}
}
