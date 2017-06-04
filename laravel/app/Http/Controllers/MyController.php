<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class MyController extends Controller
{
    public function index()
    {
    	return "ABOUT";
    }
    public function my_home()
    {
    	$people=[

          '小明1',
          '小明2',
          '小明3',
          '小明4'
    	];
    	return view('my_home',compact('people'));
    }
}
