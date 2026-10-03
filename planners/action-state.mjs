// Preserve observation values while avoiding repeated JSON coordinate keys.
// Full environment observations remain in trajectory.execution_state.
export function actionState(state,blueprint,phase){
  const {nearby_blocks,resource_blocks,...rest}=state;
  return {...rest,phase,building_plan:blueprint,
    nearby_block_columns:['name','x','y','z'],
    nearby_block_rows:(nearby_blocks??[]).map(b=>[b.name,b.position.x,b.position.y,b.position.z]),
    resource_block_columns:['x','y','z','distance'],
    resource_groups:(resource_blocks??[]).map(b=>({name:b.name,blocks:[b,...(b.alternatives??[])].map(q=>[q.position.x,q.position.y,q.position.z,q.distance])}))};
}
