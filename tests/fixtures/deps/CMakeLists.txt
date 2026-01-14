cmake_minimum_required(VERSION 3.16)
project(TestProject)

# Required packages
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)

# Optional packages
find_package(ZLIB)
find_package(Boost 1.70 COMPONENTS system filesystem)

# pkg-config modules
pkg_check_modules(GLIB REQUIRED glib-2.0>=2.50 gio-2.0)
pkg_check_modules(CURL_PKG libcurl)

# Find libraries
find_library(MYSQLCLIENT_LIB mysql)
find_library(LZMA_LIB NAMES lzma liblzma)
find_library(CRYPTO_LIB NAMES crypto REQUIRED)
