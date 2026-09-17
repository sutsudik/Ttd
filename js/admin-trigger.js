(function(){
  "use strict";
  var count=0,last=0,timer=null;
  document.addEventListener("DOMContentLoaded",function(){
    var brand=document.querySelector(".brand");
    if(!brand)return;
    brand.addEventListener("click",function(e){
      var now=Date.now();
      if(now-last>1800) count=0;
      last=now; count++;
      if(timer)clearTimeout(timer);
      timer=setTimeout(function(){count=0;},1800);
      if(count===6){e.preventDefault();count=0;window.location.href="admin.html";}
    });
  });
})();
