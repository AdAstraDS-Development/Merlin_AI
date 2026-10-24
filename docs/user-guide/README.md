# User guide

This guide describes what users see. Extend it with every feature you add: one section per task, written from the user's point of view.

## Home page

Open the app's address. The home page offers **Create a new app**, shows how many apps are online with their monthly cost, the most recent apps and **Run a simulation**.

Merlin needs you to sign in: without a session it shows **Sign in to use Merlin**. Once signed in, everyone sees the same app inventory. A **dry run** shows what would be created and what it would cost, and creates nothing. A run **through the factory** creates the app's GitHub repository from the template; Azure resources and the rest are not automated yet. A copy of Merlin without a backend (for example the static preview) runs as a simulation in your browser instead, and its apps disappear when you close the tab.

## Creating an app

1. Select **New app** (or **Create a new app**).
2. **Your idea:** name the app (the identifier is derived; select **Change** to edit it), add the problem, links and a description. You can drop or pick text files (`.md`, `.txt`, `.csv` and similar, up to 200 KB each), or select **Fill in an example**.
3. **Users and use cases:** optional. Pick user groups and list what they should be able to do, one per line; lists in your description are taken over.
4. **Where it runs:** choose the environments, data storage, tier and cost center.
5. **Review and start:** check the names and the cost. Select **Start dry run**, or choose **Through the factory**, type the app's identifier to confirm and select **Create repository**. **Through the factory** is greyed out until a platform admin has set up Merlin's access to GitHub (its GitHub App or a token).

The run page shows each step and the commands a real run would execute. A run through the factory shows the steps it does not do yet as **Skipped** and links the new repository; the app then has the status **Requested**. If the repository exists already, the run stops without changing anything: choose another identifier or repository name. When it finishes, open the feature board or the app.

## Apps, connection map and feature board

- **Apps** lists every app with its status and who requested it; search by name or filter by status. Apps created by dry runs have the status **Simulated**.
- An app's page shows the connection map from repository to live URL. Select **Run check** to see which connections would be checked (a dry-run check; live checks are not available yet); select a connection to see its explanation. The Cost card shows the simulated monthly cost.
- **Feature board** shows requests moving through spec, grill, size, build, reviews and human approval. Add one with **New request** or **Simulate a request**.
- Added feature-board requests are kept until Merlin restarts.
- Platform admins (Entra app role `Factory.Admin`) also see **Simulate**, which starts a dry run of a sample app, and may change where an app runs on the **Where it runs** step.
- **How it works** explains the process for requesters and the architecture for technical readers.
- The sun or moon button switches between light and dark theme.

## Signing in

1. Select **Sign in**.
2. Sign in with your organization's Microsoft account.
3. You arrive in your workspace, which greets you by name.

If you cancel or sign-in fails, you return to the home page.

## Signing out

Select **Sign out** in the workspace. This ends your session in the app and signs you out of Microsoft as well. Opening the workspace again requires a new sign-in.

## Sessions and errors

- A session lasts up to eight hours. After that, the workspace shows **Your session has expired**; return to the home page and sign in again.
- If your profile or the app configuration cannot be loaded, the page shows an error message instead of any protected content. Try again later or contact your administrator.
