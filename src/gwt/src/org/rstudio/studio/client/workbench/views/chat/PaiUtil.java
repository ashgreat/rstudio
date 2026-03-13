/*
 * PaiUtil.java
 *
 * Copyright (C) 2026 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
package org.rstudio.studio.client.workbench.views.chat;

import org.rstudio.studio.client.application.events.EventBus;
import org.rstudio.studio.client.projects.model.RProjectAssistantOptions;
import org.rstudio.studio.client.projects.ui.prefs.events.ProjectOptionsChangedEvent;
import org.rstudio.studio.client.workbench.model.Session;
import org.rstudio.studio.client.workbench.prefs.model.UserPrefs;
import org.rstudio.studio.client.workbench.prefs.model.UserPrefsAccessor;

import com.google.inject.Inject;
import com.google.inject.Singleton;

/**
 * Utility class for Posit AI (PAI) feature availability checks.
 */
@Singleton
public class PaiUtil
{
   @Inject
   public PaiUtil(Session session, UserPrefs userPrefs, EventBus events)
   {
      session_ = session;
      userPrefs_ = userPrefs;

      // Initialize cached project options from session info
      projectOptions_ = session_.getSessionInfo().getAssistantProjectOptions();

      // Listen for project options changes to keep cache updated
      events.addHandler(ProjectOptionsChangedEvent.TYPE, (event) ->
      {
         projectOptions_ = event.getData().getAssistantOptions();
      });
   }

   /**
    * Returns true if the Posit AI feature is enabled.
    *
    * @return true if PAI is enabled, false otherwise
    */
   public boolean isPaiEnabled()
   {
      return session_.getSessionInfo().getPositAssistantEnabled();
   }

   /**
    * Returns true if the user has selected Posit AI as their assistant, checking:
    * 1. Project-level assistant setting (if set and not "default")
    * 2. Global user preference
    *
    * @return true if Posit AI is the effective assistant, false otherwise
    */
   public boolean isPaiSelected()
   {
      return getConfiguredAssistant().equals(UserPrefsAccessor.ASSISTANT_POSIT);
   }

   /**
    * Returns the configured assistant, checking:
    * 1. Project-level assistant setting (if set and not "default")
    * 2. Global user preference
    *
    * @return The effective assistant value
    */
   public String getConfiguredAssistant()
   {
      // Check for project-level override (only if there's an active project)
      if (projectOptions_ != null && session_.getSessionInfo().getActiveProjectFile() != null)
      {
         String projectAssistant = projectOptions_.assistant;
         if (projectAssistant != null &&
             !projectAssistant.isEmpty() &&
             !projectAssistant.equals("default"))
         {
            return projectAssistant;
         }
      }

      // Fall back to global preference
      return userPrefs_.assistant().getGlobalValue();
   }

   /**
    * Returns true if Posit AI is the configured chat provider, checking:
    * 1. Project-level chat provider setting (if set and not "default")
    * 2. Global user preference
    *
    * @return true if Posit AI is the effective chat provider, false otherwise
    */
   public boolean isChatProviderPosit()
   {
      return getConfiguredChatProvider().equals(UserPrefsAccessor.CHAT_PROVIDER_POSIT);
   }

   /**
    * Returns true if chat is disabled (provider set to "none"), checking:
    * 1. Project-level chat provider setting (if set and not "default")
    * 2. Global user preference
    *
    * @return true if chat is disabled, false otherwise
    */
   public boolean isChatProviderNone()
   {
      return getConfiguredChatProvider().equals(UserPrefsAccessor.CHAT_PROVIDER_NONE);
   }

   /**
    * Returns the configured chat provider, checking:
    * 1. Project-level chat provider setting (if set and not "default")
    * 2. Global user preference
    *
    * @return The effective chat provider value
    */
   public String getConfiguredChatProvider()
   {
      // Check for project-level override (only if there's an active project)
      if (projectOptions_ != null && session_.getSessionInfo().getActiveProjectFile() != null)
      {
         String projectChatProvider = projectOptions_.chat_provider;
         if (projectChatProvider != null &&
             !projectChatProvider.isEmpty() &&
             !projectChatProvider.equals("default"))
         {
            return projectChatProvider;
         }
      }

      // Fall back to global preference
      return userPrefs_.chatProvider().getGlobalValue();
   }

   /**
    * Returns true if a BYOK (Bring Your Own Key) provider is the configured chat provider.
    *
    * @return true if the chat provider is Anthropic, OpenAI, or Google Gemini
    */
   public boolean isChatProviderByok()
   {
      String provider = getConfiguredChatProvider();
      return provider.equals(UserPrefsAccessor.CHAT_PROVIDER_ANTHROPIC) ||
             provider.equals(UserPrefsAccessor.CHAT_PROVIDER_OPENAI) ||
             provider.equals(UserPrefsAccessor.CHAT_PROVIDER_GOOGLE_GEMINI);
   }

   /**
    * Returns true if a BYOK (Bring Your Own Key) provider is the configured assistant.
    *
    * @return true if the assistant is Anthropic, OpenAI, or Google Gemini
    */
   public boolean isAssistantByok()
   {
      String assistant = getConfiguredAssistant();
      return assistant.equals(UserPrefsAccessor.ASSISTANT_ANTHROPIC) ||
             assistant.equals(UserPrefsAccessor.ASSISTANT_OPENAI) ||
             assistant.equals(UserPrefsAccessor.ASSISTANT_GOOGLE_GEMINI);
   }

   /**
    * Returns a human-readable display name for the configured chat provider.
    *
    * @return Display name for the chat provider, or empty string if unknown
    */
   public String getChatProviderDisplayName()
   {
      String provider = getConfiguredChatProvider();
      if (provider.equals(UserPrefsAccessor.CHAT_PROVIDER_ANTHROPIC))
         return "Claude (Anthropic)";
      if (provider.equals(UserPrefsAccessor.CHAT_PROVIDER_OPENAI))
         return "GPT (OpenAI)";
      if (provider.equals(UserPrefsAccessor.CHAT_PROVIDER_GOOGLE_GEMINI))
         return "Gemini (Google)";
      if (provider.equals(UserPrefsAccessor.CHAT_PROVIDER_POSIT))
         return "Posit Assistant";
      return "";
   }

   private final Session session_;
   private final UserPrefs userPrefs_;
   private RProjectAssistantOptions projectOptions_;
}
