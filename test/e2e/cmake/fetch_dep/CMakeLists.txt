cmake_minimum_required(VERSION 3.20)
project(e2e_fetch_dep C)

add_library(e2e_fetch_dep STATIC dep.c)
target_include_directories(e2e_fetch_dep PUBLIC "${CMAKE_CURRENT_LIST_DIR}")
