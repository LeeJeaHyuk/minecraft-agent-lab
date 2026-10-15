import {buildingMaterials,compileBlueprint} from '../environment/construction.mjs';
export function designBlueprint(design,sites){
  const site=sites.find(s=>s.id===design?.site_id);
  if(!site||!['north','south','west','east'].includes(design.entrance))throw Error('invalid_build_site_or_entrance');
  for(const key of ['floor','walls','roof'])if(!buildingMaterials.includes(design[key]))throw Error('invalid_build_material');
  if(design.accent&&!buildingMaterials.includes(design.accent))throw Error('invalid_accent');
  const n=site.size,last=n-1;
  const cuboids=[{from:[0,0,0],to:[last,0,last],material:design.floor},{from:[0,3,0],to:[last,3,last],material:design.roof},
    {from:[0,1,0],to:[last,2,0],material:design.walls},{from:[0,1,last],to:[last,2,last],material:design.walls},
    {from:[0,1,1],to:[0,2,last-1],material:design.walls},{from:[last,1,1],to:[last,2,last-1],material:design.walls}];
  if(design.accent){const y=design.accent_level??2;if(![1,2].includes(y))throw Error('invalid_accent_level');for(const [from,to] of [[[0,y,0],[last,y,0]],[[0,y,last],[last,y,last]],[[0,y,1],[0,y,last-1]],[[last,y,1],[last,y,last-1]]])cuboids.push({from,to,material:design.accent});}
  const entry={north:[1,0],south:[1,last],west:[0,1],east:[last,1]}[design.entrance];
  const blueprint={site_id:site.id,material:design.walls,description:design.description??'Model-designed room',cuboids,openings:[[entry[0],1,entry[1]],[entry[0],2,entry[1]]]};
  return {blueprint,compiled:compileBlueprint(blueprint,sites)};
}
