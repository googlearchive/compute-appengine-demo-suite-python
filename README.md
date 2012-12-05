# Google Compute Engine demo suite

## Setup Instructions

1. Update the application value in the root app.yaml file to your own
App Engine app identity.

application: your-app-id

More information about the app.yaml file can be found in the [App
Engine documentation][1].

2. Add a client_secrets.json file within the lib/gc_appengine directory
with your client id and secrets, as found in the API console. The file
should look something like this:

{
  "web": {
    "client_id": "24043....apps.googleusercontent.com",
    "client_secret": "iPVXC5...xVz",
    "redirect_uris": ["http://localhost:8080/oauth2callback",
                      "http://<your-app-id>.appspot.com/oauth2callback"],
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://accounts.google.com/o/oauth2/token"
  }
}

More information about client secrets can be found in the
[API client library documentation][2].

3. The Fractal demo requires addition of a Service email account to your
project team members. The Service email account is of the format

your-app-id@appspot.gserviceaccount.com

Add this to your list of team members in the API console under the Team
section.

More information about Service accounts can be found in the
[API client library documentation][3].

4. Update the DEFAULT_PROJECT_ID in lib/gc_appengine/gce_appengine.py
with your own project id:

DEFAULT_PROJECT_ID = "<your-project-id>"

Information on how to get your Compute Engine project ID can be found
in the [Compute Engine documentation][4].

5. (optional) You can optionally create custom images for the Fractal and
Image Magick demos that will allow the instances to start quicker. First, start
the instances using the demo UI. When at least one of the instances is up
and running, ssh into that instance and follow the directions [here][5] for
creating an image for an instance.

Name the images 'fractal-demo-image' and 'image-magick-demo-image' respectively.

6. Install dependencies listed in the dependencies section.

## Dependencies

Add to /lib directory
- [python_gflags-2.0][6]
- [httplib2-0.7.7][7]
- [oauth2client-1.0][8]

Add to /static/bootstrap directory
- [Twitter bootstrap][9]

[1]: https://developers.google.com/appengine/docs/python/config/appconfig#About_app_yaml
[2]: https://developers.google.com/api-client-library/python/guide/aaa_client_secrets
[3]: https://developers.google.com/api-client-library/python/platforms/google_app_engine#ServiceAccounts
[4]: https://developers.google.com/compute/docs/faq#wherecanifind
[5]: https://developers.google.com/compute/docs/images#installinganimage
[6]: http://code.google.com/p/python-gflags/
[7]: http://code.google.com/p/httplib2/
[8]: http://pypi.python.org/pypi/oauth2client/1.0
[9]: http://twitter.github.com/bootstrap/
