<!--A Design by W3layouts
Author: W3layout
Author URL: http://w3layouts.com
License: Creative Commons Attribution 3.0 Unported
License URL: http://creativecommons.org/licenses/by/3.0/
-->
<!DOCTYPE HTML>
<html>
<head>
<title>梦梦家园</title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<script src="{{asset('js/jquery.js')}}"></script>
<script src="{{asset('js/kkcountdown.js')}}"></script>
		<script type="text/javascript">
            $(document).ready(function(){
                $(".kkcount-down-1").kkcountdown({
                	dayText		: 'day ',
                	daysText 	: 'days ',
                    hoursText	: 'h ',
                    minutesText	: 'm ',
                    secondsText	: 's',
                    displayZeroDays : false,
                    callback	: test,
                    oneDayClass	: 'one-day'
                });
                $(".kkcount-down").kkcountdown({
                	dayText		: ' ',
                	daysText 	: ' ',
                    hoursText	: ' : ',
                    minutesText	: ' : ',
                    secondsText	: '',
                    displayZeroDays : false,
                    callback	: test,
                    addClass	: ''
                });
            });
            function test(){
            	console.log('KONIEC');
            }
        </script>
<style type="text/css">
body{
	font-family: Arial, Helvetica, sans-serif;
	background: url("{{asset('public/images/bg5.png')}}") no-repeat center fixed;
	-webkit-background-size: cover;
	-moz-background-size: cover;
	-o-background-size: cover;
	background-size: cover;
	background-position: center;
	background-size: 100% 100%;
}
.wrap{
	margin:0 auto;
}
.main{
	margin-bottom: 70px;
}
#content{
    text-align: center;
    margin: auto;
}
#odliczanie-a{
    font-size: 4em;
   font-family: "Courier New" ,Arial, Helvetica, sans-serif;
   color: #FFF;
}
.header{
	text-align: center;
	padding:10px 0;
}
.logo h1{
	color:#fff;
	font-weight:bold;
	font-size:2em;
	text-transform:uppercase;
	font-family:"Courier New" ,Arial, Helvetica, sans-serif;
}
.contact{
	text-align: center;
	margin-top: -40px;
	padding-bottom:30px;
}
.follow{
	text-align: center;
	padding: 0 250px;
	cursor:pointer;
}
.follow h3{
	color:#fff;
	font-size:1.5em;
	border-bottom:1px dotted rgba(255, 255, 255, 0.4);
	padding-bottom:15px;
	font-family: "Courier New" ,Arial, Helvetica, sans-serif;
}
.follow img:hover{
	opacity:0.8;
}
.footer{
	position:absolute;
	bottom:10px;
	right:10px;
	font-size:14px;
	color:#ccc;
}
.footer a{
	color:#fff;
	text-decoration:none;
}
@media all and (max-width:1024px) and (min-width:800px){
.header {
	padding: 5px 0;
}
.logo h1{
	font-size:25px;
}
#odliczanie-a {
	font-size:50px;
}
.contact {
	margin-top: -60px;
	padding-bottom: 10px;
}
.follow h3 {
	font-size:18px;
}
}
@media all and (max-width:800px) and (min-width:640px){
.header {
	padding: 5px 0;
}
.logo h1{
	font-size:25px;
}
#odliczanie-a {
	font-size:50px;
}
.contact {
	margin-top: -60px;
	padding-bottom: 10px;
}
.follow h3 {
	font-size:18px;
}
.contact img{
	width:200px;
}
}
@media all and (max-width:640px) and (min-width:480px){
.header {
	padding: 5px 0;
}
.logo h1{
	font-size:20px;
}
#odliczanie-a {
	font-size:40px;
}
.contact {
	margin-top: -60px;
	padding-bottom: 10px;
}
.follow h3 {
	font-size:18px;
}
.follow {
	padding: 0 120px;
}
.contact img{
	width:180px;
}
}
@media all and (max-width:480px) and (min-width:320px){
.header {
	padding: 5px 0;
}
.logo h1{
	font-size:20px;
}
#odliczanie-a {
	font-size:30px;
	font-weight:bold;
}
.contact {
	margin-top: -60px;
	padding-bottom: 10px;
}
.follow h3 {
	font-size:18px;
}
.follow {
	padding: 0 100px;
}
.contact img{
	width:150px;
}
}
@media all and (max-width:320px) and (min-width:240px){
.header {
	padding: 5px 0;
}
.logo h1{
	font-size:15px;
}
#odliczanie-a {
	font-size:25px;
}
.contact {
	margin-top: -60px;
	padding-bottom: 10px;
}
.follow h3 {
	font-size:18px;
}
.follow {
	padding: 0 20px;
}
.contact img{
	width:120px;
}
}
</style>
</head>
<body>
<div class="wrap">	
 	 <div class="header">
			<div class="logo">
				<h1>梦梦家园欢迎你</h1>
			</div>
	</div>	
	<div class="main">			
		<div id="content">
            <div id="odliczanie-a">
                <span time="1412870400" class="kkcount-down"></span>
            </div>   
      	</div>
    </div>
	<div class="contact">
		<img src="{{asset('public/images/manimg.png')}}" alt=""/>
	</div>
	<div class="follow">
		<h3>欢迎你来到梦梦家园</h3>
		<img src="{{asset('public/images/tw.png')}}" alt=""/>
		<img src="{{asset('public/images/fm.png')}}" alt=""/>
		<img src="{{asset('public/images/buzz.png')}}" alt=""/>
		<img src="{{asset('public/images/vimeo.png')}}" alt=""/>
		<img src="{{asset('public/images/stuble.png')}}" alt=""/>
		<img src="{{asset('public/images/skype.png')}}" alt=""/>
	</div>
	
</div>
</body>