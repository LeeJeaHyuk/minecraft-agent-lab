export function attributedChat({text,source='system',model=null}){
  if(!['qwen','kev','system'].includes(source))throw new Error('invalid_chat_source');
  if(model!==null&&(typeof model!=='string'||!/^[a-zA-Z0-9._/-]{1,80}$/.test(model)))throw new Error('invalid_chat_model');
  const name=source==='system'?'시스템':source==='qwen'?'Qwen':'Kev';
  const label=source==='system'||!model?name:`${name}: ${model.split('/').at(-1)}`;
  return {text,source,model,display_text:`[${label}] ${text}`};
}
