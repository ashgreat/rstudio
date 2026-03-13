#
# CMakeLists.txt
#
# Copyright (C) 2026 by Posit Software, PBC
#
# This program is licensed to you under the terms of version 3 of the
# GNU Affero General Public License. This program is distributed WITHOUT
# ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
# MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
# AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
#

cmake_minimum_required(VERSION 3.6.3)

include(../CMakeNodeTools.txt)

if(NOT NODEJS)
   message(STATUS "Node.js not found, skipping ai-providers build")
   return()
endif()

set(AI_PROVIDERS_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

add_custom_target(ai-providers ALL
   COMMAND ${NPM} ci
   COMMAND ${NPM} run build
   COMMAND ${NPM} prune --production
   WORKING_DIRECTORY "${AI_PROVIDERS_DIR}"
   COMMENT "Building BYOK AI providers service"
)

install(
   DIRECTORY "${AI_PROVIDERS_DIR}/dist/"
   DESTINATION "${RSTUDIO_INSTALL_RESOURCES}/ai-providers/dist"
)

install(
   FILES "${AI_PROVIDERS_DIR}/package.json"
   DESTINATION "${RSTUDIO_INSTALL_RESOURCES}/ai-providers"
)

install(
   DIRECTORY "${AI_PROVIDERS_DIR}/node_modules/"
   DESTINATION "${RSTUDIO_INSTALL_RESOURCES}/ai-providers/node_modules"
)
